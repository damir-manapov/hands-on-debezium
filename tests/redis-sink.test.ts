import type { Redis } from 'ioredis';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createConnector,
  createPostgresClient,
  createRedisClient,
  DEBEZIUM_URL,
  insertUser,
  POSTGRES_SOURCE_CONNECTOR,
  REDIS_SINK_CONNECTOR,
  REDIS_SINK_URL,
  waitForConnectorRunning,
} from '../src/index.js';

/**
 * Debezium envelope value JSON: {"schema":{...},"payload":{"before":...,"after":{...},...}}
 * Extract the 'after' record from the payload.
 */
function extractAfterFromValue(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as { payload: { after: Record<string, unknown> } };
  return parsed.payload.after;
}

/**
 * Poll Redis by direct key lookup (O(1) GET) until the key exists.
 * The connector uses ExtractField$Key + Cast$Key so Redis keys are plain
 * stringified PG ids like "123".
 */
async function pollRedisForId(
  redis: Redis,
  targetId: number,
  maxWaitMs: number,
  pollIntervalMs = 2000
): Promise<string | null> {
  const key = String(targetId);
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const value = await redis.get(key);
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return null;
}

describe('Redis Sink Connector', () => {
  let sql: postgres.Sql;
  let redis: Redis;
  let warmupUserId: number;
  let warmupUserEmail: string;

  beforeAll(async () => {
    sql = createPostgresClient();
    redis = createRedisClient();

    // 1. Ensure Debezium source connector is running (needed for CDC pipeline)
    await createConnector(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR);
    await waitForConnectorRunning(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR.name, 30000);

    // 2. Create Redis sink connector
    await createConnector(REDIS_SINK_URL, REDIS_SINK_CONNECTOR);
    await waitForConnectorRunning(REDIS_SINK_URL, REDIS_SINK_CONNECTOR.name, 60000);

    // 3. Warm up the pipeline: insert a record and wait for it to appear in Redis.
    // The connector writes to Redis on each put() call. The main delay
    // is the Kafka Connect data poll interval (up to 60s when idle for the first poll).
    const warmupEmail = `redis-warmup-${Date.now()}@example.com`;
    const [warmupUser] = await insertUser(sql, warmupEmail, 'Redis Warmup User');
    const warmupId = warmupUser?.id;

    if (!warmupId) {
      throw new Error('Failed to insert warmup user');
    }

    warmupUserId = warmupId;
    warmupUserEmail = warmupEmail;

    // Poll for the warmup record in Redis
    const warmupValue = await pollRedisForId(redis, warmupId, 120000);

    if (!warmupValue) {
      throw new Error(
        'Pipeline warmup failed: warmup record did not appear in Redis within 2 minutes'
      );
    }
  });

  afterAll(async () => {
    redis.disconnect();
    await sql.end();
  });

  describe('Connector lifecycle', () => {
    it('should have Redis sink connector created', async () => {
      const response = await fetch(`${REDIS_SINK_URL}/connectors/${REDIS_SINK_CONNECTOR.name}`);
      expect(response.ok).toBe(true);
    });

    it('should have connector in RUNNING state', async () => {
      await waitForConnectorRunning(REDIS_SINK_URL, REDIS_SINK_CONNECTOR.name, 10000);
    });
  });

  describe('CDC to Redis flow', () => {
    it('should store Debezium envelope with correct structure', async () => {
      // Direct O(1) lookup by the warmup user's id
      const value = await redis.get(String(warmupUserId));
      expect(value).toBeDefined();

      // Value should be the full Debezium envelope with payload.after containing our fields
      const after = extractAfterFromValue(value as string);
      expect(after).toHaveProperty('id');
      expect(after).toHaveProperty('email');
      expect(after).toHaveProperty('name');
    });

    it('should use PostgreSQL id as Redis key for direct lookups', async () => {
      // Direct GET by id — this is the whole point of ExtractField + Cast transforms
      const value = await redis.get(String(warmupUserId));
      expect(value).toBeDefined();

      const after = extractAfterFromValue(value as string);
      expect(after['id']).toBe(warmupUserId);
      expect(after['email']).toBe(warmupUserEmail);
    });

    it('should sync new PostgreSQL changes to Redis', async () => {
      const timestamp = Date.now();
      const email = `redis-sync-test-${timestamp}@example.com`;
      const [user] = await insertUser(sql, email, 'Redis Sync Test User');
      const userId = user?.id;
      expect(userId).toBeDefined();

      // Poll by direct GET — no KEYS scan needed
      const value = await pollRedisForId(redis, userId as number, 90000);
      expect(value).not.toBeNull();

      const after = extractAfterFromValue(value as string);
      expect(after['email']).toBe(email);
      expect(after['name']).toBe('Redis Sync Test User');
    });

    it('should maintain data consistency between PostgreSQL and Redis', async () => {
      // Direct O(1) lookup by warmup user id
      const value = await redis.get(String(warmupUserId));
      expect(value).toBeDefined();

      const after = extractAfterFromValue(value as string);

      // Verify against PostgreSQL
      const pgRows = await sql`SELECT id, email, name FROM users WHERE id = ${warmupUserId}`;
      expect(pgRows).toHaveLength(1);
      expect(after['email']).toBe(pgRows[0]?.['email']);
      expect(after['name']).toBe(pgRows[0]?.['name']);
    });
  });
});

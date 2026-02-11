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
 * Debezium key JSON: {"schema":{...},"payload":{"id":123}}
 * Extract the id from the payload.
 */
function extractIdFromKey(key: string): number {
  const parsed = JSON.parse(key) as { payload: { id: number } };
  return parsed.payload.id;
}

/**
 * Debezium envelope value JSON: {"schema":{...},"payload":{"before":...,"after":{...},...}}
 * Extract the 'after' record from the payload.
 */
function extractAfterFromValue(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as { payload: { after: Record<string, unknown> } };
  return parsed.payload.after;
}

/**
 * Poll Redis for a key whose Debezium payload.id matches the given id.
 * Returns the raw value string if found, null if timed out.
 */
async function pollRedisForId(
  redis: Redis,
  targetId: number,
  maxWaitMs: number,
  pollIntervalMs = 2000
): Promise<string | null> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const keys = await redis.keys('*');
    for (const key of keys) {
      // Skip internal Kafka offset tracking keys
      if (key.startsWith('__kafka.offset.')) continue;
      try {
        const id = extractIdFromKey(key);
        if (id === targetId) {
          return redis.get(key);
        }
      } catch {
        // Not a valid Debezium key, skip
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return null;
}

describe('Redis Sink Connector', () => {
  let sql: postgres.Sql;
  let redis: Redis;

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
      // Get any non-internal key from Redis
      const keys = (await redis.keys('*')).filter((k) => !k.startsWith('__kafka.offset.'));
      expect(keys.length).toBeGreaterThan(0);

      const value = await redis.get(keys[0]!);
      expect(value).toBeDefined();

      // Value should be the full Debezium envelope with payload.after containing our fields
      const after = extractAfterFromValue(value!);
      expect(after).toHaveProperty('id');
      expect(after).toHaveProperty('email');
      expect(after).toHaveProperty('name');
    });

    it('should use Debezium key containing PostgreSQL id', async () => {
      // Get a non-internal key and verify it contains the document's id
      const keys = (await redis.keys('*')).filter((k) => !k.startsWith('__kafka.offset.'));
      expect(keys.length).toBeGreaterThan(0);

      const key = keys[0]!;
      const keyId = extractIdFromKey(key);
      const value = await redis.get(key);
      const after = extractAfterFromValue(value!);

      // The id extracted from the Debezium key should match the after payload's id
      expect(keyId).toBe(after['id']);
    });

    it('should sync new PostgreSQL changes to Redis', async () => {
      const timestamp = Date.now();
      const email = `redis-sync-test-${timestamp}@example.com`;
      const [user] = await insertUser(sql, email, 'Redis Sync Test User');
      const userId = user?.id;
      expect(userId).toBeDefined();

      // Poll for the new record in Redis by its PG id
      const value = await pollRedisForId(redis, userId!, 90000);
      expect(value).not.toBeNull();

      const after = extractAfterFromValue(value!);
      expect(after['email']).toBe(email);
      expect(after['name']).toBe('Redis Sync Test User');
    });

    it('should maintain data consistency between PostgreSQL and Redis', async () => {
      // Pick a non-internal key from Redis and verify it matches the PG row
      const keys = (await redis.keys('*')).filter((k) => !k.startsWith('__kafka.offset.'));
      expect(keys.length).toBeGreaterThan(0);

      const key = keys[0]!;
      const value = await redis.get(key);
      expect(value).toBeDefined();

      const after = extractAfterFromValue(value!);
      const docId = after['id'] as number;
      const pgRows = await sql`SELECT id, email, name FROM users WHERE id = ${docId}`;
      expect(pgRows).toHaveLength(1);
      expect(pgRows[0]?.['email']).toBe(after['email']);
      expect(pgRows[0]?.['name']).toBe(after['name']);
    });
  });
});

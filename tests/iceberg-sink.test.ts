import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createConnector,
  createPostgresClient,
  DEBEZIUM_URL,
  executeTrinoQuery,
  ICEBERG_SINK_CONNECTOR,
  ICEBERG_SINK_URL,
  insertUser,
  POSTGRES_SOURCE_CONNECTOR,
  waitForConnectorRunning,
} from '../src/index.js';

/**
 * Poll Trino until a query returns at least one row, or timeout.
 * Returns true if data was found, false if timed out.
 */
async function pollTrinoUntilFound(
  query: string,
  maxWaitMs: number,
  pollIntervalMs = 3000
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const result = await executeTrinoQuery<Record<string, unknown>>(query);
      if (result.data.length > 0) {
        return true;
      }
    } catch {
      // Table might not exist yet, continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

describe('Iceberg Sink Connector', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = createPostgresClient();

    // Create both connectors in beforeAll to ensure they exist for all tests
    // 1. Ensure Debezium source connector is running (needed for CDC pipeline)
    await createConnector(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR);
    await waitForConnectorRunning(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR.name, 30000);

    // 2. Create Iceberg sink connector
    await createConnector(ICEBERG_SINK_URL, ICEBERG_SINK_CONNECTOR);
    await waitForConnectorRunning(ICEBERG_SINK_URL, ICEBERG_SINK_CONNECTOR.name, 60000);

    // 3. Warm up the pipeline: insert a record and wait for it to appear in Iceberg.
    // The Iceberg sink connector's Worker needs time to:
    //   - Create its control consumer group and join
    //   - Receive a START_COMMIT from the Coordinator
    //   - Respond with DATA_WRITTEN + DATA_COMPLETE
    // The Kafka Connect data poll has a 60s timeout when idle, so the worker's
    // control consumer processing only runs once per minute. This means the first
    // successful commit can take several minutes.
    const warmupEmail = `warmup-${Date.now()}@example.com`;
    await insertUser(sql, warmupEmail, 'Warmup User');

    const warmupFound = await pollTrinoUntilFound(
      `SELECT email FROM iceberg.cdc.users WHERE email = '${warmupEmail}'`,
      240000 // 4 minutes for initial pipeline warmup
    );

    if (!warmupFound) {
      throw new Error(
        'Pipeline warmup failed: warmup record did not appear in Iceberg within 4 minutes'
      );
    }
  });

  afterAll(async () => {
    // Note: We don't delete connectors here to avoid race conditions with parallel tests
    // The connectors will be cleaned up on next test run via beforeAll (idempotent creation)
    await sql.end();
  });

  describe('Connector lifecycle', () => {
    it('should have Iceberg sink connector created', async () => {
      // Connector already created in beforeAll, just verify it exists
      const response = await fetch(`${ICEBERG_SINK_URL}/connectors/${ICEBERG_SINK_CONNECTOR.name}`);
      expect(response.ok).toBe(true);
    });

    it('should have connector in RUNNING state', async () => {
      // Already verified in beforeAll, but let's confirm
      await waitForConnectorRunning(ICEBERG_SINK_URL, ICEBERG_SINK_CONNECTOR.name, 10000);
    });
  });

  describe('CDC to Iceberg flow', () => {
    it('should create cdc namespace in Iceberg', async () => {
      // The warmup phase in beforeAll already proved the pipeline works,
      // so the cdc namespace should already exist
      const result = await executeTrinoQuery<{ Schema: string }>('SHOW SCHEMAS IN iceberg');
      const schemas = result.data.map((r) => r.Schema);

      // The connector should auto-create the 'cdc' namespace
      expect(schemas).toContain('cdc');
    });

    it('should sync PostgreSQL changes to Iceberg tables', async () => {
      // Insert a new user in PostgreSQL
      const timestamp = Date.now();
      const email = `iceberg-test-${timestamp}@example.com`;
      await insertUser(sql, email, 'Iceberg Test User');

      // Wait for CDC pipeline: PostgreSQL → Debezium → Kafka → Iceberg Sink
      // The pipeline is already warm from beforeAll, so this should be faster.
      // However, we still need to wait for:
      //  - Debezium to capture the change (~1-2s)
      //  - Kafka Connect data poll to return (~up to 60s when idle)
      //  - Iceberg commit cycle (~10s interval + worker processing)
      const found = await pollTrinoUntilFound(
        `SELECT email FROM iceberg.cdc.users WHERE email = '${email}'`,
        90000 // 90 seconds for a warm pipeline
      );

      expect(found).toBe(true);
    });
  });
});

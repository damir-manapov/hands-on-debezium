import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createConnector,
  createPostgresClient,
  DEBEZIUM_URL,
  POSTGRES_SOURCE_CONNECTOR,
  waitForConnectorRunning,
} from '../src/index.js';

describe('Debezium CDC', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = createPostgresClient();
  });

  afterAll(async () => {
    // Note: We don't delete the postgres-source connector here to avoid race conditions
    // with parallel tests (e.g., iceberg-sink.test.ts depends on this connector).
    // Connectors are idempotent - they will be reused or recreated on next test run.
    await sql.end();
  });

  describe('Debezium Connector', () => {
    it('should create PostgreSQL source connector', async () => {
      const response = await createConnector(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR);

      // 201 = created, 409 = already exists
      expect([201, 409]).toContain(response.status);
    });

    it('should have connector in RUNNING state', async () => {
      await waitForConnectorRunning(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR.name, 60000);
    });
  });
});

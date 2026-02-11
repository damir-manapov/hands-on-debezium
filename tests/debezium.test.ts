import type { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createConnector,
  createElasticsearchClient,
  createPostgresClient,
  DEBEZIUM_URL,
  deleteConnector,
  POSTGRES_SOURCE_CONNECTOR,
  waitForConnectorRunning,
} from '../src/index.js';

describe('Debezium CDC', () => {
  let sql: postgres.Sql;
  let esClient: ElasticsearchClient;

  beforeAll(async () => {
    sql = createPostgresClient();
    esClient = createElasticsearchClient();
  });

  afterAll(async () => {
    // Note: We don't delete the postgres-source connector here to avoid race conditions
    // with parallel tests (e.g., iceberg-sink.test.ts depends on this connector).
    // Connectors are idempotent - they will be reused or recreated on next test run.
    await sql.end();
    await esClient.close();
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

  describe('Elasticsearch connectivity', () => {
    it('should connect to Elasticsearch', async () => {
      const info = await esClient.info();
      expect(info.cluster_name).toBeDefined();
    });

    it('should be able to create and delete test index', async () => {
      const testIndex = 'test-debezium-index';

      // Create index
      await esClient.indices.create({ index: testIndex });

      // Verify exists
      const exists = await esClient.indices.exists({ index: testIndex });
      expect(exists).toBe(true);

      // Cleanup
      await esClient.indices.delete({ index: testIndex });
    });
  });
});

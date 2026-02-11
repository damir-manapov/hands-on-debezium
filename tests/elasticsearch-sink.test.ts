import type { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createConnector,
  createElasticsearchClient,
  createPostgresClient,
  DEBEZIUM_URL,
  ELASTICSEARCH_SINK_CONNECTOR,
  ELASTICSEARCH_SINK_URL,
  insertUser,
  POSTGRES_SOURCE_CONNECTOR,
  searchDocuments,
  waitForConnectorRunning,
} from '../src/index.js';

/**
 * Poll Elasticsearch until a query returns at least one matching document, or timeout.
 * Returns true if data was found, false if timed out.
 */
async function pollEsUntilFound(
  esClient: ElasticsearchClient,
  index: string,
  field: string,
  value: string,
  maxWaitMs: number,
  pollIntervalMs = 2000
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const results = await searchDocuments<Record<string, unknown>>(esClient, index, {
        term: { [field]: value },
      });
      if (results.length > 0) {
        return true;
      }
    } catch {
      // Index might not exist yet, continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

describe('Elasticsearch Sink Connector', () => {
  let sql: postgres.Sql;
  let esClient: ElasticsearchClient;

  beforeAll(async () => {
    sql = createPostgresClient();
    esClient = createElasticsearchClient();

    // 1. Ensure Debezium source connector is running (needed for CDC pipeline)
    await createConnector(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR);
    await waitForConnectorRunning(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR.name, 30000);

    // 2. Create Elasticsearch sink connector
    await createConnector(ELASTICSEARCH_SINK_URL, ELASTICSEARCH_SINK_CONNECTOR);
    await waitForConnectorRunning(ELASTICSEARCH_SINK_URL, ELASTICSEARCH_SINK_CONNECTOR.name, 60000);

    // 3. Warm up the pipeline: insert a record and wait for it to appear in ES.
    // Unlike the Iceberg sink, the Confluent ES connector doesn't have a control
    // topic protocol — it writes directly to ES on each put() call. The main delay
    // is the Kafka Connect data poll interval (up to 60s when idle for the first poll).
    const warmupEmail = `es-warmup-${Date.now()}@example.com`;
    await insertUser(sql, warmupEmail, 'ES Warmup User');

    const warmupFound = await pollEsUntilFound(
      esClient,
      'dbz.public.users',
      'email.keyword',
      warmupEmail,
      120000 // 2 minutes for initial pipeline warmup
    );

    if (!warmupFound) {
      throw new Error(
        'Pipeline warmup failed: warmup record did not appear in Elasticsearch within 2 minutes'
      );
    }
  });

  afterAll(async () => {
    await esClient.close();
    await sql.end();
  });

  describe('Connector lifecycle', () => {
    it('should have Elasticsearch sink connector created', async () => {
      const response = await fetch(
        `${ELASTICSEARCH_SINK_URL}/connectors/${ELASTICSEARCH_SINK_CONNECTOR.name}`
      );
      expect(response.ok).toBe(true);
    });

    it('should have connector in RUNNING state', async () => {
      await waitForConnectorRunning(
        ELASTICSEARCH_SINK_URL,
        ELASTICSEARCH_SINK_CONNECTOR.name,
        10000
      );
    });
  });

  describe('CDC to Elasticsearch flow', () => {
    it('should create index for users topic', async () => {
      const exists = await esClient.indices.exists({ index: 'dbz.public.users' });
      expect(exists).toBe(true);
    });

    it('should have documents with correct structure', async () => {
      const results = await searchDocuments<{
        id: number;
        email: string;
        name: string;
      }>(esClient, 'dbz.public.users');

      expect(results.length).toBeGreaterThan(0);

      const doc = results[0];
      expect(doc).toBeDefined();
      // Verify Debezium envelope was unwrapped — fields should be top-level
      expect(doc?.email).toBeDefined();
      expect(doc?.name).toBeDefined();
      expect(doc?.id).toBeDefined();
    });

    it('should use record key as document _id', async () => {
      // The extractKey transform pulls 'id' from the Debezium key struct,
      // so ES document _id should match the PostgreSQL id
      const response = await esClient.search({
        index: 'dbz.public.users',
        size: 1,
      });

      const hit = response.hits.hits[0];
      expect(hit).toBeDefined();
      // Document _id should be the stringified PostgreSQL id
      expect(hit?._id).toBe(String(hit?._source && (hit._source as { id: number }).id));
    });

    it('should sync new PostgreSQL changes to Elasticsearch', async () => {
      const timestamp = Date.now();
      const email = `es-sync-test-${timestamp}@example.com`;
      await insertUser(sql, email, 'ES Sync Test User');

      // The pipeline is already warm from beforeAll. The Confluent ES connector
      // writes to ES immediately on put(), so latency is mainly the data poll interval.
      const found = await pollEsUntilFound(
        esClient,
        'dbz.public.users',
        'email.keyword',
        email,
        90000
      );

      expect(found).toBe(true);
    });

    it('should maintain document count consistency', async () => {
      // Count documents in ES
      const esCount = await esClient.count({ index: 'dbz.public.users' });

      // ES should have at least the warmup record and the sync-test record
      expect(esCount.count).toBeGreaterThanOrEqual(2);

      // Every document in ES should have a matching row in PG
      const esDocs = await searchDocuments<{ id: number; email: string }>(
        esClient,
        'dbz.public.users'
      );
      for (const doc of esDocs) {
        const pgRow = await sql`SELECT id FROM users WHERE id = ${doc.id}`;
        expect(pgRow.length).toBe(1);
      }
    });
  });
});

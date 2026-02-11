import type { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createElasticsearchClient, searchDocuments, waitForDocumentCount } from '../src/index.js';

describe('Elasticsearch operations', () => {
  let esClient: ElasticsearchClient;

  const testIndices = ['test_index', 'test_mapped', 'test_temp', 'test_documents'];

  async function deleteTestIndices(): Promise<void> {
    // Explicitly delete each test index (wildcard deletion may be blocked)
    await Promise.allSettled(testIndices.map((idx) => esClient.indices.delete({ index: idx })));
  }

  beforeAll(async () => {
    esClient = createElasticsearchClient();

    // Clean up any leftover test indices from previous runs
    await deleteTestIndices();
  });

  afterAll(async () => {
    await deleteTestIndices();
    await esClient.close();
  });

  describe('Elasticsearch connectivity', () => {
    it('should connect and return cluster info', async () => {
      const info = await esClient.info();
      expect(info.cluster_name).toBeDefined();
      expect(info.version.number).toBeDefined();
    });

    it('should report healthy cluster status', async () => {
      const health = await esClient.cluster.health();
      expect(['green', 'yellow']).toContain(health.status);
    });
  });

  describe('Index operations', () => {
    const testIndex = 'test_index';

    it('should create an index', async () => {
      await esClient.indices.create({ index: testIndex });

      const exists = await esClient.indices.exists({ index: testIndex });
      expect(exists).toBe(true);
    });

    it('should create index with explicit mapping', async () => {
      const mappedIndex = 'test_mapped';

      await esClient.indices.create({
        index: mappedIndex,
        mappings: {
          properties: {
            email: { type: 'keyword' },
            name: { type: 'text' },
            age: { type: 'integer' },
            created_at: { type: 'date' },
          },
        },
      });

      const mapping = await esClient.indices.getMapping({ index: mappedIndex });
      const properties = mapping[mappedIndex]?.mappings?.properties;
      expect(properties).toBeDefined();
      expect(properties?.['email']).toEqual(expect.objectContaining({ type: 'keyword' }));
      expect(properties?.['age']).toEqual(expect.objectContaining({ type: 'integer' }));
    });

    it('should delete an index', async () => {
      const tempIndex = 'test_temp';
      await esClient.indices.create({ index: tempIndex });
      await esClient.indices.delete({ index: tempIndex });

      const exists = await esClient.indices.exists({ index: tempIndex });
      expect(exists).toBe(false);
    });
  });

  describe('Document operations', () => {
    const docIndex = 'test_documents';

    beforeAll(async () => {
      await esClient.indices.create({
        index: docIndex,
        mappings: {
          properties: {
            email: { type: 'keyword' },
            name: { type: 'text' },
            value: { type: 'double' },
          },
        },
      });
    });

    it('should index and retrieve a document', async () => {
      await esClient.index({
        index: docIndex,
        id: '1',
        document: { email: 'alice@example.com', name: 'Alice', value: 1.5 },
        refresh: true,
      });

      const doc = await esClient.get<{ email: string; name: string; value: number }>({
        index: docIndex,
        id: '1',
      });

      expect(doc._source?.email).toBe('alice@example.com');
      expect(doc._source?.name).toBe('Alice');
      expect(doc._source?.value).toBe(1.5);
    });

    it('should index multiple documents and search', async () => {
      await esClient.index({
        index: docIndex,
        id: '2',
        document: { email: 'bob@example.com', name: 'Bob', value: 2.5 },
        refresh: true,
      });

      const results = await searchDocuments<{ email: string; name: string; value: number }>(
        esClient,
        docIndex
      );

      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.some((r) => r.email === 'alice@example.com')).toBe(true);
      expect(results.some((r) => r.email === 'bob@example.com')).toBe(true);
    });

    it('should search with a query filter', async () => {
      const results = await searchDocuments<{ email: string }>(esClient, docIndex, {
        term: { email: 'alice@example.com' },
      });

      expect(results.length).toBe(1);
      expect(results[0]?.email).toBe('alice@example.com');
    });

    it('should wait for document count', async () => {
      await waitForDocumentCount(esClient, docIndex, 2, 5000);
      // If we get here without throwing, the assertion passed
    });

    it('should update a document', async () => {
      await esClient.update({
        index: docIndex,
        id: '1',
        doc: { name: 'Alice Updated' },
        refresh: true,
      });

      const doc = await esClient.get<{ name: string }>({ index: docIndex, id: '1' });
      expect(doc._source?.name).toBe('Alice Updated');
    });

    it('should delete a document', async () => {
      await esClient.delete({ index: docIndex, id: '2', refresh: true });

      const results = await searchDocuments(esClient, docIndex);
      expect(results.length).toBe(1);
    });
  });
});

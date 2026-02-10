import { Client as ElasticsearchClient } from '@elastic/elasticsearch';

export const DEFAULT_ES_CONFIG = {
  node: 'http://localhost:9200',
};

export function createElasticsearchClient(node = DEFAULT_ES_CONFIG.node) {
  return new ElasticsearchClient({ node });
}

export async function waitForIndex(
  client: ElasticsearchClient,
  indexName: string,
  timeoutMs = 30000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const exists = await client.indices.exists({ index: indexName });
      if (exists) {
        return;
      }
    } catch {
      // Index doesn't exist yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Index ${indexName} did not appear within ${timeoutMs}ms`);
}

export async function searchDocuments<T>(
  client: ElasticsearchClient,
  indexName: string,
  query: object = { match_all: {} }
): Promise<T[]> {
  const response = await client.search<T>({
    index: indexName,
    query,
  });
  return response.hits.hits.map((hit) => hit._source).filter((doc): doc is T => doc !== undefined);
}

export async function waitForDocumentCount(
  client: ElasticsearchClient,
  indexName: string,
  expectedCount: number,
  timeoutMs = 30000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await client.count({ index: indexName });
      if (response.count >= expectedCount) {
        return;
      }
    } catch {
      // Index not ready
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Index ${indexName} did not reach ${expectedCount} documents within ${timeoutMs}ms`
  );
}

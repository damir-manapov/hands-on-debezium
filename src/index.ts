export type { ConnectorConfig } from './connectors.js';
export {
  createConnector,
  DEBEZIUM_URL,
  deleteConnector,
  ELASTICSEARCH_SINK_CONNECTOR,
  ELASTICSEARCH_SINK_URL,
  getConnectorStatus,
  ICEBERG_SINK_CONNECTOR,
  ICEBERG_SINK_URL,
  POSTGRES_SOURCE_CONNECTOR,
  REDIS_SINK_CONNECTOR,
  REDIS_SINK_URL,
  waitForConnectorRunning,
} from './connectors.js';
export type { DbConfig, Order, User } from './db.js';
export { createPostgresClient, getAllOrders, getAllUsers, insertOrder, insertUser } from './db.js';

export {
  createElasticsearchClient,
  searchDocuments,
  waitForDocumentCount,
  waitForIndex,
} from './elasticsearch.js';

export {
  createIcebergNamespace,
  createIcebergTable,
  executeTrinoQuery,
  getTrinoClient,
  insertIntoIceberg,
  queryIcebergTable,
  resetTrinoClient,
  TRINO_CONFIG,
} from './trino.js';

export { createRedisClient } from './redis.js';

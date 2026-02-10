export type { ConnectorConfig } from './connectors.js';
export {
  createConnector,
  DEBEZIUM_URL,
  deleteConnector,
  ELASTICSEARCH_SINK_CONNECTOR,
  ELASTICSEARCH_SINK_URL,
  getConnectorStatus,
  POSTGRES_SOURCE_CONNECTOR,
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

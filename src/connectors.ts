export interface ConnectorConfig {
  name: string;
  config: Record<string, string>;
}

export const POSTGRES_SOURCE_CONNECTOR: ConnectorConfig = {
  name: 'postgres-source',
  config: {
    'connector.class': 'io.debezium.connector.postgresql.PostgresConnector',
    'database.hostname': 'postgres',
    'database.port': '5432',
    'database.user': 'postgres',
    'database.password': 'postgres',
    'database.dbname': 'app',
    'topic.prefix': 'dbz',
    'table.include.list': 'public.users,public.orders',
    'plugin.name': 'pgoutput',
    'publication.name': 'debezium_pub',
    'slot.name': 'debezium_slot',
  },
};

export const ELASTICSEARCH_SINK_CONNECTOR: ConnectorConfig = {
  name: 'elasticsearch-sink',
  config: {
    'connector.class': 'io.confluent.connect.elasticsearch.ElasticsearchSinkConnector',
    'connection.url': 'http://elasticsearch:9200',
    topics: 'dbz.public.users,dbz.public.orders',
    'tasks.max': '1',
    // Transform chain: unwrap Debezium envelope + extract key field for document ID
    transforms: 'unwrap,extractKey',
    // 1. Extract only the 'after' payload from Debezium envelope
    'transforms.unwrap.type': 'io.debezium.transforms.ExtractNewRecordState',
    'transforms.unwrap.drop.tombstones': 'true',
    // 2. Extract 'id' from struct key to use as ES document _id
    'transforms.extractKey.type': 'org.apache.kafka.connect.transforms.ExtractField$Key',
    'transforms.extractKey.field': 'id',
    // Use extracted key as document ID for upsert semantics
    'key.ignore': 'false',
    // Schema handling
    'schema.ignore': 'true',
    // Write behavior
    'behavior.on.null.values': 'DELETE',
    'write.method': 'UPSERT',
  },
};

export const REDIS_SINK_CONNECTOR: ConnectorConfig = {
  name: 'redis-sink',
  config: {
    'connector.class': 'com.github.jcustenborder.kafka.connect.redis.RedisSinkConnector',
    'redis.hosts': 'redis:6379',
    'redis.database': '0',
    topics: 'dbz.public.users,dbz.public.orders',
    'tasks.max': '1',
    // This connector only accepts String or byte[] for both key and value.
    // StringConverter reads raw Kafka bytes as UTF-8 strings, which is what we need
    // since Debezium produces JSON-serialized keys and values.
    // The Redis key will be the Debezium key JSON (contains the PG id),
    // and the value will be the full Debezium envelope JSON (contains before/after/source).
    'key.converter': 'org.apache.kafka.connect.storage.StringConverter',
    'value.converter': 'org.apache.kafka.connect.storage.StringConverter',
  },
};

export const ICEBERG_SINK_CONNECTOR: ConnectorConfig = {
  name: 'iceberg-sink',
  config: {
    // Official Apache Iceberg Kafka Connect sink
    'connector.class': 'org.apache.iceberg.connect.IcebergSinkConnector',
    'tasks.max': '1',

    // Subscribe to Debezium CDC topics
    'topics.regex': 'dbz\\.public\\.(users|orders)',

    // Start from earliest offset to capture existing messages
    'consumer.override.auto.offset.reset': 'earliest',

    // Iceberg tables configuration
    'iceberg.tables': 'cdc.users,cdc.orders',
    'iceberg.tables.route-field': '_cdc.target',
    'iceberg.tables.auto-create-enabled': 'true',
    'iceberg.tables.evolve-schema-enabled': 'true',

    // Route CDC topics to Iceberg tables
    'iceberg.table.cdc.users.route-regex': '.*users$',
    'iceberg.table.cdc.orders.route-regex': '.*orders$',

    // Control topic configuration - commit every 10 seconds for faster testing
    'iceberg.control.commit.interval-ms': '10000',
    'iceberg.control.commit.timeout-ms': '60000',

    // Nessie catalog configuration
    'iceberg.catalog.catalog-impl': 'org.apache.iceberg.nessie.NessieCatalog',
    'iceberg.catalog.uri': 'http://nessie:19120/api/v2',
    'iceberg.catalog.ref': 'main',
    'iceberg.catalog.warehouse': 's3://warehouse',
    'iceberg.catalog.io-impl': 'org.apache.iceberg.aws.s3.S3FileIO',
    'iceberg.catalog.s3.endpoint': 'http://minio:9000',
    'iceberg.catalog.s3.access-key-id': 'minioadmin',
    'iceberg.catalog.s3.secret-access-key': 'minioadmin',
    'iceberg.catalog.s3.path-style-access': 'true',
    'iceberg.catalog.s3.region': 'us-east-1',
    'iceberg.catalog.client.region': 'us-east-1',

    // Debezium transform to extract CDC fields
    transforms: 'debezium',
    'transforms.debezium.type': 'org.apache.iceberg.connect.transforms.DebeziumTransform',

    // Converters - schemas.enable must be true to match Debezium output format
    'key.converter': 'org.apache.kafka.connect.json.JsonConverter',
    'key.converter.schemas.enable': 'true',
    'value.converter': 'org.apache.kafka.connect.json.JsonConverter',
    'value.converter.schemas.enable': 'true',
  },
};

export const DEBEZIUM_URL = 'http://localhost:8083';
export const ELASTICSEARCH_SINK_URL = 'http://localhost:8084';
export const ICEBERG_SINK_URL = 'http://localhost:8085';
export const REDIS_SINK_URL = 'http://localhost:8086';

export async function createConnector(
  baseUrl: string,
  connector: ConnectorConfig
): Promise<Response> {
  const response = await fetch(`${baseUrl}/connectors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(connector),
  });
  return response;
}

export async function getConnectorStatus(
  baseUrl: string,
  name: string
): Promise<{ connector: { state: string }; tasks: Array<{ state: string }> }> {
  const response = await fetch(`${baseUrl}/connectors/${name}/status`);
  return response.json() as Promise<{
    connector: { state: string };
    tasks: Array<{ state: string }>;
  }>;
}

export async function deleteConnector(baseUrl: string, name: string): Promise<Response> {
  return fetch(`${baseUrl}/connectors/${name}`, { method: 'DELETE' });
}

export async function waitForConnectorRunning(
  baseUrl: string,
  name: string,
  timeoutMs = 30000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const status = await getConnectorStatus(baseUrl, name);
      if (
        status.connector.state === 'RUNNING' &&
        status.tasks.every((t) => t.state === 'RUNNING')
      ) {
        return;
      }
    } catch {
      // Connector not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Connector ${name} did not reach RUNNING state within ${timeoutMs}ms`);
}

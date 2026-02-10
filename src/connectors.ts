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
    'connector.class': 'io.debezium.connector.jdbc.JdbcSinkConnector',
    'connection.url': 'jdbc:elasticsearch://elasticsearch:9200',
    'topics.regex': 'dbz.public.*',
    'insert.mode': 'upsert',
    'primary.key.mode': 'record_key',
    'primary.key.fields': 'id',
  },
};

export const DEBEZIUM_URL = 'http://localhost:8083';
export const ELASTICSEARCH_SINK_URL = 'http://localhost:8084';

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

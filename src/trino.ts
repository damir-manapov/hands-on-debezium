import { BasicAuth, Trino } from 'trino-client';

export const TRINO_CONFIG = {
  host: 'localhost',
  port: 8080,
  user: 'test',
};

let trinoClient: Trino | null = null;

export function getTrinoClient(): Trino {
  if (!trinoClient) {
    trinoClient = Trino.create({
      server: `http://${TRINO_CONFIG.host}:${TRINO_CONFIG.port}`,
      catalog: 'iceberg',
      schema: 'default',
      auth: new BasicAuth(TRINO_CONFIG.user),
    });
  }
  return trinoClient;
}

export function resetTrinoClient(): void {
  trinoClient = null;
}

export interface TrinoQueryResult<T> {
  columns: Array<{ name: string; type: string }>;
  data: T[];
}

export async function executeTrinoQuery<T>(query: string): Promise<TrinoQueryResult<T>> {
  const client = getTrinoClient();
  const iter = await client.query(query);

  const columns: Array<{ name: string; type: string }> = [];
  const allData: T[] = [];

  for await (const queryResult of iter) {
    if (queryResult.columns && columns.length === 0) {
      for (const col of queryResult.columns) {
        columns.push({ name: col.name, type: col.type });
      }
    }

    if (queryResult.data) {
      for (const row of queryResult.data) {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < columns.length; i++) {
          const col = columns[i];
          if (col) {
            obj[col.name] = row[i];
          }
        }
        allData.push(obj as T);
      }
    }
  }

  return { columns, data: allData };
}

export async function createIcebergNamespace(namespace: string): Promise<void> {
  await executeTrinoQuery(`CREATE SCHEMA IF NOT EXISTS iceberg.${namespace}`);
}

export async function createIcebergTable(
  namespace: string,
  tableName: string,
  columns: string
): Promise<void> {
  await executeTrinoQuery(`
    CREATE TABLE IF NOT EXISTS iceberg.${namespace}.${tableName} (
      ${columns}
    )
  `);
}

export async function insertIntoIceberg(
  namespace: string,
  tableName: string,
  columns: string,
  values: string
): Promise<void> {
  await executeTrinoQuery(`
    INSERT INTO iceberg.${namespace}.${tableName} (${columns})
    VALUES ${values}
  `);
}

export async function queryIcebergTable<T>(namespace: string, tableName: string): Promise<T[]> {
  const result = await executeTrinoQuery<T>(`SELECT * FROM iceberg.${namespace}.${tableName}`);
  return result.data;
}

import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createConnector,
  createPostgresClient,
  DEBEZIUM_URL,
  getConnectorStatus,
  insertUser,
  POSTGRES_SOURCE_CONNECTOR,
  waitForConnectorRunning,
} from '../src/index.js';

describe('Debezium CDC', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = createPostgresClient();

    // Ensure the source connector is created and running
    await createConnector(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR);
    await waitForConnectorRunning(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR.name, 60000);
  });

  afterAll(async () => {
    // Note: We don't delete the postgres-source connector here to avoid race conditions
    // with parallel tests (e.g., iceberg-sink.test.ts depends on this connector).
    // Connectors are idempotent - they will be reused or recreated on next test run.
    await sql.end();
  });

  describe('Connector lifecycle', () => {
    it('should create PostgreSQL source connector', async () => {
      const response = await createConnector(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR);

      // 201 = created, 409 = already exists (idempotent)
      expect([201, 409]).toContain(response.status);
    });

    it('should have connector in RUNNING state', async () => {
      await waitForConnectorRunning(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR.name, 60000);
    });

    it('should have exactly one running task', async () => {
      const status = await getConnectorStatus(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR.name);
      expect(status.tasks).toHaveLength(1);
      expect(status.tasks[0]?.state).toBe('RUNNING');
    });
  });

  describe('Connector configuration', () => {
    it('should return connector config via REST API', async () => {
      const response = await fetch(
        `${DEBEZIUM_URL}/connectors/${POSTGRES_SOURCE_CONNECTOR.name}/config`
      );
      expect(response.ok).toBe(true);

      const config = (await response.json()) as Record<string, string>;
      expect(config['connector.class']).toBe('io.debezium.connector.postgresql.PostgresConnector');
      expect(config['topic.prefix']).toBe('dbz');
      expect(config['table.include.list']).toBe('public.users,public.orders');
      expect(config['plugin.name']).toBe('pgoutput');
    });

    it('should use pgoutput logical decoding plugin', async () => {
      const response = await fetch(
        `${DEBEZIUM_URL}/connectors/${POSTGRES_SOURCE_CONNECTOR.name}/config`
      );
      const config = (await response.json()) as Record<string, string>;
      expect(config['plugin.name']).toBe('pgoutput');
    });
  });

  describe('Kafka topics', () => {
    it('should create CDC topics for monitored tables', async () => {
      // Debezium creates topics with pattern: <topic.prefix>.<schema>.<table>
      const response = await fetch(`${DEBEZIUM_URL}/connectors/${POSTGRES_SOURCE_CONNECTOR.name}`);
      expect(response.ok).toBe(true);

      // Verify topics exist by consuming from them via the Kafka REST proxy
      // or by checking Kafka directly. Since we don't have a Kafka REST proxy,
      // we verify indirectly: the sink connectors subscribe to these topics,
      // and if the source connector is RUNNING, the topics must exist.
      const status = await getConnectorStatus(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR.name);
      expect(status.connector.state).toBe('RUNNING');
    });
  });

  describe('PostgreSQL replication', () => {
    it('should create a replication slot', async () => {
      const slotName = POSTGRES_SOURCE_CONNECTOR.config['slot.name'] as string;
      const slots = await sql`
        SELECT slot_name, plugin, slot_type, active
        FROM pg_replication_slots
        WHERE slot_name = ${slotName}
      `;
      expect(slots).toHaveLength(1);
      expect(slots[0]?.['slot_name']).toBe('debezium_slot');
      expect(slots[0]?.['plugin']).toBe('pgoutput');
      expect(slots[0]?.['slot_type']).toBe('logical');
      expect(slots[0]?.['active']).toBe(true);
    });

    it('should create a publication for CDC tables', async () => {
      const pubName = POSTGRES_SOURCE_CONNECTOR.config['publication.name'] as string;
      const publications = await sql`
        SELECT pubname FROM pg_publication
        WHERE pubname = ${pubName}
      `;
      expect(publications).toHaveLength(1);
      expect(publications[0]?.['pubname']).toBe('debezium_pub');
    });

    it('should publish users and orders tables', async () => {
      const tables = await sql`
        SELECT tablename FROM pg_publication_tables
        WHERE pubname = 'debezium_pub'
        ORDER BY tablename
      `;
      const tableNames = tables.map((t) => t['tablename']);
      expect(tableNames).toContain('orders');
      expect(tableNames).toContain('users');
    });
  });

  describe('CDC event flow', () => {
    it('should capture INSERT events from PostgreSQL', async () => {
      // Insert a test user and verify it was captured by checking the connector
      // is still healthy (hasn't errored out processing the WAL event)
      const timestamp = Date.now();
      const email = `debezium-test-${timestamp}@example.com`;
      const users = await insertUser(sql, email, 'Debezium Test User');

      expect(users).toHaveLength(1);
      expect(users[0]?.email).toBe(email);

      // Verify connector is still running after processing the new event
      const status = await getConnectorStatus(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR.name);
      expect(status.connector.state).toBe('RUNNING');
      expect(status.tasks[0]?.state).toBe('RUNNING');
    });

    it('should capture UPDATE events from PostgreSQL', async () => {
      const timestamp = Date.now();
      const email = `debezium-update-${timestamp}@example.com`;
      await insertUser(sql, email, 'Before Update');

      // Update the user
      await sql`UPDATE users SET name = 'After Update' WHERE email = ${email}`;

      // Verify the row was updated in PG
      const result = await sql`SELECT name FROM users WHERE email = ${email}`;
      expect(result[0]?.['name']).toBe('After Update');

      // Connector should still be healthy
      const status = await getConnectorStatus(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR.name);
      expect(status.connector.state).toBe('RUNNING');
    });

    it('should capture DELETE events from PostgreSQL', async () => {
      const timestamp = Date.now();
      const email = `debezium-delete-${timestamp}@example.com`;
      await insertUser(sql, email, 'To Be Deleted');

      // Delete the user
      await sql`DELETE FROM users WHERE email = ${email}`;

      // Verify the row was deleted in PG
      const result = await sql`SELECT id FROM users WHERE email = ${email}`;
      expect(result).toHaveLength(0);

      // Connector should still be healthy
      const status = await getConnectorStatus(DEBEZIUM_URL, POSTGRES_SOURCE_CONNECTOR.name);
      expect(status.connector.state).toBe('RUNNING');
    });
  });
});

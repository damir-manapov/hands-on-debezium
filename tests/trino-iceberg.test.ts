import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createIcebergNamespace,
  createIcebergTable,
  createPostgresClient,
  executeTrinoQuery,
  getAllOrders,
  getAllUsers,
  insertIntoIceberg,
  insertOrder,
  insertUser,
  queryIcebergTable,
} from '../src/index.js';

describe('PostgreSQL to Trino/Iceberg sync', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = createPostgresClient();
  });

  afterAll(async () => {
    await sql.end();
  });

  describe('PostgreSQL operations', () => {
    it('should have initial seed data in users table', async () => {
      const users = await getAllUsers(sql);
      expect(users.length).toBeGreaterThanOrEqual(3);
      expect(users.some((u) => u.email === 'alice@example.com')).toBe(true);
    });

    it('should have initial seed data in orders table', async () => {
      const orders = await getAllOrders(sql);
      expect(orders.length).toBeGreaterThanOrEqual(4);
    });

    it('should insert new user', async () => {
      const timestamp = Date.now();
      const email = `test-${timestamp}@example.com`;
      const [user] = await insertUser(sql, email, 'Test User');

      expect(user).toBeDefined();
      expect(user?.email).toBe(email);
      expect(user?.name).toBe('Test User');
    });

    it('should insert new order', async () => {
      const users = await getAllUsers(sql);
      const firstUser = users[0];
      expect(firstUser).toBeDefined();

      const [order] = await insertOrder(sql, firstUser!.id, 99.99, 'pending');

      expect(order).toBeDefined();
      expect(order?.user_id).toBe(firstUser!.id);
      expect(order?.total_amount).toBe('99.99');
    });
  });

  describe('Trino connectivity', () => {
    it('should connect to Trino and execute simple query', async () => {
      const result = await executeTrinoQuery<{ _col0: number }>('SELECT 1');
      expect(result.data.length).toBe(1);
    });

    it('should query PostgreSQL via Trino', async () => {
      const result = await executeTrinoQuery<{ id: number; email: string; name: string }>(
        'SELECT id, email, name FROM postgres.public.users LIMIT 5'
      );
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data[0]).toHaveProperty('email');
    });
  });

  describe('Iceberg operations via Trino', () => {
    const testNamespace = 'test_ns';

    it('should create Iceberg namespace', async () => {
      await createIcebergNamespace(testNamespace);

      const result = await executeTrinoQuery<{ Schema: string }>('SHOW SCHEMAS IN iceberg');
      const schemas = result.data.map((r) => r.Schema);
      expect(schemas).toContain(testNamespace);
    });

    it('should create Iceberg table', async () => {
      await createIcebergTable(
        testNamespace,
        'test_table',
        `
        id INTEGER,
        name VARCHAR,
        value DOUBLE
      `
      );

      const result = await executeTrinoQuery<{ Table: string }>(
        `SHOW TABLES IN iceberg.${testNamespace}`
      );
      const tables = result.data.map((r) => r.Table);
      expect(tables).toContain('test_table');
    });

    it('should insert and query data from Iceberg table', async () => {
      await insertIntoIceberg(testNamespace, 'test_table', 'id, name, value', "(1, 'foo', 1.5)");
      await insertIntoIceberg(testNamespace, 'test_table', 'id, name, value', "(2, 'bar', 2.5)");

      const rows = await queryIcebergTable<{ id: number; name: string; value: number }>(
        testNamespace,
        'test_table'
      );

      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.some((r) => r.name === 'foo')).toBe(true);
      expect(rows.some((r) => r.name === 'bar')).toBe(true);
    });
  });
});

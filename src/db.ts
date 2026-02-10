import postgres from 'postgres';

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export const DEFAULT_DB_CONFIG: DbConfig = {
  host: 'localhost',
  port: 5432,
  user: 'postgres',
  password: 'postgres',
  database: 'app',
};

export function createPostgresClient(config: DbConfig = DEFAULT_DB_CONFIG) {
  return postgres({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
  });
}

export interface User {
  id: number;
  email: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export interface Order {
  id: number;
  user_id: number;
  total_amount: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export async function insertUser(sql: postgres.Sql, email: string, name: string): Promise<User[]> {
  return sql<User[]>`
    INSERT INTO users (email, name)
    VALUES (${email}, ${name})
    RETURNING *
  `;
}

export async function insertOrder(
  sql: postgres.Sql,
  userId: number,
  totalAmount: number,
  status = 'pending'
): Promise<Order[]> {
  return sql<Order[]>`
    INSERT INTO orders (user_id, total_amount, status)
    VALUES (${userId}, ${totalAmount}, ${status})
    RETURNING *
  `;
}

export async function getAllUsers(sql: postgres.Sql): Promise<User[]> {
  return sql<User[]>`SELECT * FROM users ORDER BY id`;
}

export async function getAllOrders(sql: postgres.Sql): Promise<Order[]> {
  return sql<Order[]>`SELECT * FROM orders ORDER BY id`;
}

-- Create nessie schema for Nessie catalog metadata
CREATE SCHEMA IF NOT EXISTS nessie;

-- Create public schema tables for application data (will be synced via Debezium)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    total_amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create publication for Debezium CDC
CREATE PUBLICATION debezium_pub FOR TABLE users, orders;

-- Insert some sample data
INSERT INTO users (email, name) VALUES
    ('alice@example.com', 'Alice Johnson'),
    ('bob@example.com', 'Bob Smith'),
    ('charlie@example.com', 'Charlie Brown');

INSERT INTO orders (user_id, total_amount, status) VALUES
    (1, 150.00, 'completed'),
    (1, 75.50, 'pending'),
    (2, 200.00, 'completed'),
    (3, 50.25, 'shipped');

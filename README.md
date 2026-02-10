# Hands-On Debezium

A hands-on project for learning Debezium Change Data Capture (CDC) - syncing PostgreSQL tables to Trino/Iceberg data lake and Elasticsearch.

## Architecture

```
┌───────────┐     ┌─────────┐     ┌─────────┐     ┌──────────────┐
│ PostgreSQL│────▶│ Debezium│────▶│  Kafka  │────▶│ Trino/Iceberg│
│   (CDC)   │     │ Connect │     │         │     │  (Data Lake) │
└───────────┘     └─────────┘     └─────────┘     └──────────────┘
                                       │
                                       ▼
                               ┌───────────────┐
                               │ Elasticsearch │
                               │   (Search)    │
                               └───────────────┘
```

**Components:**
- **PostgreSQL** - Source database with CDC enabled (WAL logical replication)
- **Debezium Connect** - CDC connector capturing changes from PostgreSQL
- **Kafka** - Message broker for streaming CDC events
- **MinIO** - S3-compatible object storage for Iceberg data
- **Nessie** - Iceberg catalog with Git-like versioning (uses PostgreSQL for metadata)
- **Trino** - Distributed SQL query engine for analytics
- **Elasticsearch** - Search and analytics engine

## Prerequisites

- Docker & Docker Compose
- Node.js 22+
- pnpm 9+
- gitleaks (for security checks)

## Getting Started

1. Install dependencies:
   ```sh
   pnpm install
   ```

2. Start all services:
   ```sh
   pnpm run up
   ```

3. Run tests:
   ```sh
   pnpm test
   ```

4. Stop services:
   ```sh
   pnpm run down
   ```

5. Reset (remove volumes):
   ```sh
   pnpm run reset
   ```

## Services Endpoints

| Service       | Port  | URL                          |
|---------------|-------|------------------------------|
| PostgreSQL    | 5432  | `localhost:5432`             |
| Kafka         | 9092  | `localhost:9092`             |
| Debezium      | 8083  | `http://localhost:8083`      |
| MinIO Console | 9001  | `http://localhost:9001`      |
| MinIO API     | 9000  | `http://localhost:9000`      |
| Nessie        | 19120 | `http://localhost:19120`     |
| Trino         | 8080  | `http://localhost:8080`      |
| Elasticsearch | 9200  | `http://localhost:9200`      |

## Project Structure

```
├── compose/
│   ├── postgres-init/     # PostgreSQL initialization scripts
│   └── trino/
│       └── catalog/       # Trino catalog configurations
├── src/
│   ├── connectors.ts      # Debezium connector management
│   ├── db.ts              # PostgreSQL client utilities
│   ├── elasticsearch.ts   # Elasticsearch client utilities
│   ├── trino.ts           # Trino query utilities
│   └── index.ts           # Main exports
├── tests/
│   ├── debezium.test.ts   # Debezium CDC tests
│   └── trino-iceberg.test.ts  # Trino/Iceberg integration tests
└── docker-compose.yml     # Docker Compose configuration
```

## Development

Run checks:
```sh
./check.sh      # Format, lint, typecheck, test
./health.sh     # Security scan, dependency audit
./all-checks.sh # Run both
```

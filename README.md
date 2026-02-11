# Hands-On Debezium

A hands-on project for learning Debezium Change Data Capture (CDC) - syncing PostgreSQL tables to Trino/Iceberg data lake, Elasticsearch, and Redis.

## Architecture

```
                                                    ┌───────────────┐     ┌──────────────┐
                                               ┌───▶│  Iceberg Sink │────▶│ Trino/Iceberg│
                                               │    │(Kafka Connect)│     │  (Data Lake) │
┌───────────┐     ┌─────────┐     ┌─────────┐  │    └───────────────┘     └──────────────┘
│ PostgreSQL│────▶│ Debezium│────▶│  Kafka  │──┤           │
│   (CDC)   │     │ Connect │     │         │  │    ┌──────┴────────┐
└───────────┘     └─────────┘     └─────────┘  │    │ MinIO + Nessie│
                                               │    └───────────────┘
                                               │
                                               │    ┌───────────────┐     ┌───────────────┐
                                               ├───▶│    ES Sink    │────▶│ Elasticsearch │
                                               │    │(Kafka Connect)│     │   (Search)    │
                                               │    └───────────────┘     └───────────────┘
                                               │
                                               │    ┌───────────────┐     ┌───────────────┐
                                               └───▶│  Redis Sink   │────▶│     Redis     │
                                                    │(Kafka Connect)│     │   (Cache)     │
                                                    └───────────────┘     └───────────────┘
```

**Components:**
- **PostgreSQL** - Source database with CDC enabled (WAL logical replication)
- **Debezium Connect** - CDC connector capturing changes from PostgreSQL
- **Kafka** - Message broker for streaming CDC events
- **Iceberg Sink** - Apache Iceberg Kafka Connect sink (built from source, 1.9.2) with DebeziumTransform
- **MinIO** - S3-compatible object storage for Iceberg data files
- **Nessie** - Iceberg catalog with Git-like versioning (uses PostgreSQL for metadata)
- **Trino** - Distributed SQL query engine for analytics over Iceberg tables
- **Elasticsearch** - Search and analytics engine
- **Redis Sink** - Redis Kafka Connect sink (jcustenborder/kafka-connect-redis) with StringConverter
- **Redis** - In-memory data store for caching CDC events

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

2. Pull Docker images:
   ```sh
   pnpm run compose:pull
   ```

3. Start all services:
   ```sh
   pnpm run compose:up
   ```

4. Run tests:
   ```sh
   pnpm test
   ```

5. Stop services:
   ```sh
   pnpm run compose:down
   ```

6. Reset (remove volumes):
   ```sh
   pnpm run compose:reset
   ```

## Services Endpoints

| Service       | Port  | URL                          |
|---------------|-------|------------------------------|
| PostgreSQL    | 5432  | `localhost:5432`             |
| Kafka         | 9092  | `localhost:9092`             |
| Debezium      | 8083  | `http://localhost:8083`      |
| ES Sink       | 8084  | `http://localhost:8084`      |
| Iceberg Sink  | 8085  | `http://localhost:8085`      |
| Redis Sink    | 8086  | `http://localhost:8086`      |
| Redis         | 6379  | `localhost:6379`             |
| MinIO Console | 9001  | `http://localhost:9001`      |
| MinIO API     | 9000  | `http://localhost:9000`      |
| Nessie        | 19120 | `http://localhost:19120`     |
| Trino         | 8080  | `http://localhost:8080`      |
| Elasticsearch | 9200  | `http://localhost:9200`      |

## Project Structure

```
├── compose/
│   ├── docker-compose.yml # Docker Compose configuration
│   ├── elasticsearch-sink/# ES sink connector (Confluent kafka-connect-elasticsearch)
│   ├── iceberg-sink/      # Iceberg sink connector (built from source)
│   ├── redis-sink/        # Redis sink connector (jcustenborder/kafka-connect-redis)
│   ├── postgres-init/     # PostgreSQL initialization scripts
│   └── trino/
│       └── catalog/       # Trino catalog configurations
├── docs/
│   └── ICEBERG_SINK_TROUBLESHOOTING.md  # Iceberg sink deep-dive
├── src/
│   ├── connectors.ts      # Connector configs & management
│   ├── db.ts              # PostgreSQL client utilities
│   ├── elasticsearch.ts   # Elasticsearch client utilities
│   ├── redis.ts           # Redis client utilities
│   ├── trino.ts           # Trino query utilities
│   └── index.ts           # Main exports
└── tests/
    ├── debezium.test.ts           # Debezium source connector tests
    ├── elasticsearch.test.ts      # Elasticsearch operations tests
    ├── elasticsearch-sink.test.ts # ES sink CDC pipeline tests
    ├── iceberg-sink.test.ts   # Iceberg sink CDC pipeline tests
    ├── redis-sink.test.ts     # Redis sink CDC pipeline tests
    └── trino-iceberg.test.ts  # Trino/Iceberg integration tests
```

## Documentation

- [Iceberg Sink Troubleshooting](docs/ICEBERG_SINK_TROUBLESHOOTING.md) — lessons learned integrating the Iceberg Kafka Connect sink with Debezium, Nessie, and Trino (control topic protocol, cold start timing, routing, debugging)

## Development

Run checks:
```sh
./check.sh      # Format, lint, typecheck, test
./health.sh     # Security scan, dependency audit
./all-checks.sh # Run both
```

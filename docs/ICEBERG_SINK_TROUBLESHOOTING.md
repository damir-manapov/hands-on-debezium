# Iceberg Sink Connector — Troubleshooting Guide

Lessons learned while integrating the Apache Iceberg Kafka Connect sink (1.9.2) with Debezium CDC,
Nessie catalog, and Trino.

**Stack:** Confluent Kafka Connect 8.1.1 · Debezium 3.0.0.Final · Iceberg 1.9.2 · Nessie 0.107.2 · Trino 479 · MinIO

---

## 1. No Pre-Built Image — Build from Source

There is no official Docker image for the Iceberg Kafka Connect sink.
The old `tabulario/iceberg-kafka-connect` images on Docker Hub are abandoned (last update: 2 years ago, Iceberg 0.14.x).

**Solution:** Build the connector from the Apache Iceberg source:

```dockerfile
FROM eclipse-temurin:17-jdk AS builder
COPY cache/iceberg /iceberg
WORKDIR /iceberg
RUN gradle :iceberg-kafka-connect:iceberg-kafka-connect-runtime:distZip -x test

FROM confluentinc/cp-kafka-connect:8.1.1
COPY --from=builder /iceberg/.../iceberg-kafka-connect-runtime-1.9.2 \
    /usr/share/confluent-hub-components/iceberg-kafka-connect
```

Tip: cache the Iceberg git repo and Gradle distribution locally to avoid 130 MB+ downloads on every build.

---

## 2. Separate Kafka Connect Cluster for Iceberg

Running the Iceberg sink on the same Kafka Connect instance as Debezium causes conflicts —
different converter defaults, plugin classpath collisions.

**Solution:** Run a dedicated Kafka Connect worker for the Iceberg sink on a separate port (8085),
with its own group ID, config/offset/status topics:

```yaml
iceberg-sink:
  ports: ["8085:8083"]
  environment:
    CONNECT_GROUP_ID: iceberg-sink
    CONNECT_CONFIG_STORAGE_TOPIC: iceberg_sink_configs
    CONNECT_OFFSET_STORAGE_TOPIC: iceberg_sink_offsets
    CONNECT_STATUS_STORAGE_TOPIC: iceberg_sink_status
```

---

## 3. `schemas.enable` Must Be `true`

Debezium outputs JSON with embedded schemas by default. The Iceberg sink's `DebeziumTransform` SMT
needs to navigate the Struct hierarchy (`source.schema`, `source.table`, etc.).

If `schemas.enable = false` at the **worker** level, override it on the connector:

```json
{
  "key.converter": "org.apache.kafka.connect.json.JsonConverter",
  "key.converter.schemas.enable": "true",
  "value.converter": "org.apache.kafka.connect.json.JsonConverter",
  "value.converter.schemas.enable": "true"
}
```

**Symptom if wrong:** Records arrive as plain Maps instead of Structs → `DebeziumTransform` silently
produces wrong routing targets → data goes nowhere.

---

## 4. AWS_REGION Environment Variable

The Iceberg S3FileIO requires `AWS_REGION` even when using MinIO.
Setting `s3.region` and `client.region` in the catalog config is not enough.

```yaml
environment:
  AWS_REGION: us-east-1
```

**Symptom:** `SdkClientException: Unable to load region from any of the providers in the chain`

---

## 5. How DebeziumTransform Routing Works

The `DebeziumTransform` SMT extracts CDC metadata into a `_cdc` struct. The routing field
`_cdc.target` is built from the source database metadata:

| Database   | Formula                                  | Example        |
|------------|------------------------------------------|----------------|
| PostgreSQL | `{source.schema}.{source.table}`         | `public.users` |
| MySQL      | `{source.db}.{source.table}`             | `mydb.users`   |
| SQL Server | `{source.schema}.{source.table}`         | `dbo.users`    |

The connector routes records using regex matching:

```json
{
  "iceberg.tables": "cdc.users,cdc.orders",
  "iceberg.tables.route-field": "_cdc.target",
  "iceberg.table.cdc.users.route-regex": ".*users$",
  "iceberg.table.cdc.orders.route-regex": ".*orders$"
}
```

So `_cdc.target = "public.users"` matches `.*users$` → routes to Iceberg table `cdc.users`.

---

## 6. Control Topic Commit Protocol (The Tricky Part)

The Iceberg sink uses a **control topic** (`control-iceberg` by default) to coordinate commits
between a Coordinator and Workers. This is where most of the hard-to-debug issues come from.

### How It Works

```
┌─────────────────┐                              ┌────────────┐
│   Coordinator   │──── START_COMMIT ───────────▶│   Worker   │
│  (leader task)  │                               │  (any task)│
│                 │◀── DATA_WRITTEN ─────────────│            │
│                 │◀── DATA_COMPLETE ────────────│            │
│                 │                               └────────────┘
│  commits to     │
│  Iceberg tables │
│                 │──── COMMIT_COMPLETE ─────────▶ (informational)
└─────────────────┘
```

1. **Coordinator** runs on the task that holds the first partition. It sends `START_COMMIT` on the
   control topic every `commit.interval-ms` (default: 300s, we use 10s).
2. **Worker** polls the control topic, receives `START_COMMIT`, calls `sinkWriter.completeWrite()`,
   and responds with `DATA_WRITTEN` (per table) + `DATA_COMPLETE`.
3. **Coordinator** collects responses. If all Workers respond → normal commit. If timeout
   (`commit.timeout-ms`, default 60s) → partial commit with whatever data was received.

### Why Commits Take Minutes on Cold Start

The Worker creates a **transient consumer group** (`cg-control-{random-UUID}`) for the control topic.
This consumer group:

- Is brand new every time the task starts → needs 30+ seconds for Kafka group coordinator to stabilize
- Starts from `latest` offset (no committed offsets) → misses any `START_COMMIT` sent before joining
- Uses `Duration.ZERO` for polling → returns immediately, may miss messages between polls

**But the real bottleneck is the data poll loop.** The Kafka Connect framework's `WorkerSinkTask`
polls data topics with a configurable timeout (default ~60s). The call chain is:

```
WorkerSinkTask.poll(60s timeout)  ← blocks here when no new data
  → put(records)                  ← delivers batch to IcebergSinkTask
    → CommitterImpl.save()
      → worker.process()          ← polls control topic with Duration.ZERO
```

When no CDC data is flowing, `put()` only happens **once per minute**. The Worker's control
consumer only gets polled once per minute. Combined with the commit interval and timeout:

| Phase                        | Duration    |
|------------------------------|-------------|
| Worker control group join    | ~30s        |
| Data poll timeout (idle)     | 60s         |
| Commit interval              | 10s         |
| Commit timeout               | 60s         |
| **Worst case first commit**  | **~4 min**  |

### Configuration We Use

```json
{
  "iceberg.control.commit.interval-ms": "10000",
  "iceberg.control.commit.timeout-ms": "60000",
  "consumer.override.auto.offset.reset": "earliest"
}
```

---

## 7. Parallel Test Interference

Running Debezium and Iceberg sink tests in parallel caused failures:

- `debezium.test.ts` `afterAll` deleted the `postgres-source` connector
- `iceberg-sink.test.ts` depends on `postgres-source` for the CDC pipeline

**Solution:** Don't delete connectors in `afterAll`. Create them idempotently in `beforeAll` instead.
Kafka Connect's `POST /connectors` is safe to call multiple times — it returns 409 if the connector
already exists.

---

## 8. Test Strategy: Pipeline Warmup

Because the first Iceberg commit takes minutes (see §6), tests must warm up the pipeline:

```typescript
beforeAll(async () => {
  // Create connectors...
  await waitForConnectorRunning(url, name, 60000);

  // Warm up: insert a record and wait for it in Iceberg
  const warmupEmail = `warmup-${Date.now()}@example.com`;
  await insertUser(sql, warmupEmail, 'Warmup User');

  const found = await pollTrinoUntilFound(
    `SELECT email FROM iceberg.cdc.users WHERE email = '${warmupEmail}'`,
    240000  // 4 minutes for cold start
  );
  if (!found) throw new Error('Pipeline warmup failed');
});
```

After warmup, subsequent records commit within 1–2 cycles (~10–90s depending on data poll timing).

The vitest timeout configuration reflects this:

```typescript
{
  testTimeout: 120000,   // 2 min per test
  hookTimeout: 300000,   // 5 min for beforeAll warmup
}
```

---

## 9. Quick Debugging Commands

```bash
# Check connector status
curl -s http://localhost:8085/connectors/iceberg-sink/status | jq

# Watch commit activity
docker logs compose-iceberg-sink-1 -f 2>&1 | grep -E 'committed to|START_COMMIT|DATA_WRITTEN'

# Check if Worker is receiving control messages
docker logs compose-iceberg-sink-1 --since 60s 2>&1 | grep -E 'Handled event|Sending event'

# Check data poll timing (how often put() is called)
docker logs compose-iceberg-sink-1 --since 120s 2>&1 | grep 'Delivering batch'

# Query Iceberg via Trino
docker exec compose-trino-1 trino --execute "SELECT * FROM iceberg.cdc.users"

# Check Kafka topic offsets
docker exec compose-kafka-1 kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group iceberg-sink --describe
```

---

## 10. NullPointerException During Rebalance

```
NullPointerException: Cannot invoke
"org.apache.iceberg.connect.channel.KafkaClientFactory.createAdmin()"
because "this.clientFactory" is null
```

This happens when a task is stopped during a rebalance before `CommitterImpl.initialize()` completes.
The `hasLeaderPartition()` method tries to use `clientFactory` which hasn't been set yet.

**Impact:** Harmless — Kafka Connect retries the task automatically. The NPE appears in logs during
startup/rebalance but doesn't affect steady-state operation.

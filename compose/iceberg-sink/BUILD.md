# Building Iceberg Kafka Connect Sink Image

This document describes the nuances and lessons learned while building the Apache Iceberg Kafka Connect sink connector from source.

## Why Build from Source?

The official Apache Iceberg Kafka Connect distribution does not include all catalog implementations by default. Specifically:

- **Nessie Catalog** (`org.apache.iceberg.nessie.NessieCatalog`) is NOT included in the standard distribution
- **DebeziumTransform SMT** (`org.apache.iceberg.connect.transforms.DebeziumTransform`) was added in Iceberg 1.8.0+

If you need these features, you must build from source with modifications.

## Build Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Multi-stage Docker Build                                   │
├─────────────────────────────────────────────────────────────┤
│  Stage 1: builder (eclipse-temurin:17-jdk)                  │
│    - Copies cached Iceberg source                           │
│    - Runs Gradle distZip task                               │
│    - Produces iceberg-kafka-connect-runtime-X.Y.Z.zip       │
├─────────────────────────────────────────────────────────────┤
│  Stage 2: runtime (confluentinc/cp-kafka-connect:8.1.1)     │
│    - Copies built connector to plugin directory             │
│    - Ready to run with Kafka Connect                        │
└─────────────────────────────────────────────────────────────┘
```

## Local Source Caching

To avoid re-downloading on every build, we cache both Iceberg source (~48MB) and Gradle (~130MB) locally:

```bash
cd compose/iceberg-sink/cache

# Clone specific Iceberg version
git clone --depth 1 --branch apache-iceberg-1.9.2 https://github.com/apache/iceberg.git iceberg

# CRITICAL: Create version.txt (Gradle needs this when .git is absent)
echo "1.9.2" > iceberg/version.txt

# Download Gradle distribution
mkdir -p gradle
cd gradle
curl -L -O https://services.gradle.org/distributions/gradle-8.13-bin.zip
```

The `cache/` directory is gitignored to keep the repo clean.

### Why Cache Gradle?

Without caching, every Docker build downloads Gradle 8.13 (~130MB), adding 1-2 minutes to build time:

```
Downloading https://services.gradle.org/distributions/gradle-8.13-bin.zip
```

With local cache, Gradle is copied and extracted in ~2 seconds.

### Why version.txt is Required

When copying source into Docker (without `.git` folder), Gradle cannot determine the version via `git describe`. The build fails with:

```
Neither version.txt nor git version exists
```

Solution: Create `version.txt` with the version number in the root of the Iceberg source.

## Adding Nessie Catalog Support

The default `kafka-connect-runtime` distribution does NOT include the Nessie catalog. To add it:

**Edit `kafka-connect/build.gradle`**, find the `project(':iceberg-kafka-connect:iceberg-kafka-connect-runtime')` section, and add:

```gradle
dependencies {
    // ... existing dependencies ...

    implementation project(':iceberg-gcp')
    implementation platform(libs.google.libraries.bom)
    implementation 'com.google.cloud:google-cloud-storage'

    // ADD THIS: Nessie catalog support
    implementation project(':iceberg-nessie')

    // ... rest of dependencies ...
}
```

Without this change, you'll get:

```
java.lang.ClassNotFoundException: org.apache.iceberg.nessie.NessieCatalog
```

## Version Requirements

| Feature | Minimum Version | Notes |
|---------|-----------------|-------|
| DebeziumTransform SMT | 1.8.0 | For CDC message transformation |
| Nessie Catalog | Any | Requires build.gradle modification |
| S3FileIO | Any | Included by default (via iceberg-aws) |

## Dockerfile

```dockerfile
FROM eclipse-temurin:17-jdk AS builder

ARG ICEBERG_VERSION=1.9.2
ARG GRADLE_VERSION=8.13

RUN apt-get update && apt-get install -y unzip

# Copy and install pre-downloaded Gradle (avoids 130MB download every build)
COPY cache/gradle/gradle-${GRADLE_VERSION}-bin.zip /tmp/gradle.zip
RUN mkdir -p /opt/gradle && \
    unzip -q /tmp/gradle.zip -d /opt/gradle && \
    rm /tmp/gradle.zip
ENV PATH="/opt/gradle/gradle-${GRADLE_VERSION}/bin:${PATH}"

# Copy locally cached source (must include version.txt)
COPY cache/iceberg /iceberg
WORKDIR /iceberg

# Build only the Kafka Connect runtime distribution
# Use system Gradle instead of wrapper to skip download
RUN gradle :iceberg-kafka-connect:iceberg-kafka-connect-runtime:distZip \
    -x test -x integrationTest

# Unzip the distribution
RUN cd kafka-connect/kafka-connect-runtime/build/distributions && \
    unzip iceberg-kafka-connect-runtime-${ICEBERG_VERSION}.zip

# Runtime image
FROM confluentinc/cp-kafka-connect:8.1.1

ARG ICEBERG_VERSION=1.9.2

# Copy connector to Kafka Connect plugins directory
COPY --from=builder \
    /iceberg/kafka-connect/kafka-connect-runtime/build/distributions/iceberg-kafka-connect-runtime-${ICEBERG_VERSION} \
    /usr/share/confluent-hub-components/iceberg-kafka-connect
```

## Build Commands

```bash
# First-time setup (or version upgrade)
cd compose/iceberg-sink/cache

# Remove old cache if upgrading
sudo rm -rf iceberg

# Clone Iceberg source
git clone --depth 1 --branch apache-iceberg-1.9.2 https://github.com/apache/iceberg.git iceberg
echo "1.9.2" > iceberg/version.txt

# Download Gradle (only needed once)
mkdir -p gradle
cd gradle
curl -L -O https://services.gradle.org/distributions/gradle-8.13-bin.zip

# Modify build.gradle if you need Nessie support (see above)

# Build the image
docker compose -f compose/docker-compose.yml build iceberg-sink --no-cache
```

## Build Time Expectations

| Phase | Time (without cache) | Time (with cache) |
|-------|---------------------|-------------------|
| Gradle download | ~70s | ~2s |
| Source transfer to Docker | ~1s | ~1s |
| apt-get install unzip | ~14s | ~14s |
| Gradle compilation | ~250s | ~250s |
| Unzip distribution | ~1s | ~1s |
| Final image assembly | ~4s | ~4s |
| **Total** | **~6 minutes** | **~4.5 minutes** |

## Troubleshooting

### Error: "Neither version.txt nor git version exists"

**Cause**: Iceberg source copied without `.git` folder and no `version.txt`

**Fix**: Create `version.txt` with version number:
```bash
echo "1.9.2" > cache/iceberg/version.txt
```

### Error: "ClassNotFoundException: org.apache.iceberg.nessie.NessieCatalog"

**Cause**: Nessie module not included in kafka-connect-runtime distribution

**Fix**: Add `implementation project(':iceberg-nessie')` to `kafka-connect/build.gradle`

### Error: "Class org.apache.iceberg.connect.transforms.DebeziumTransform could not be found"

**Cause**: Using Iceberg version < 1.8.0 which doesn't have DebeziumTransform

**Fix**: Upgrade to Iceberg 1.8.0 or later (1.9.2 recommended)

### Build takes too long (>10 minutes)

**Cause**: Docker is re-cloning Iceberg source every build

**Fix**: Use local cache pattern as described above

## Connector Configuration Notes

When using with Nessie catalog:

```json
{
  "iceberg.catalog.catalog-impl": "org.apache.iceberg.nessie.NessieCatalog",
  "iceberg.catalog.uri": "http://nessie:19120/api/v2",
  "iceberg.catalog.ref": "main",
  "iceberg.catalog.warehouse": "s3://warehouse",
  "iceberg.catalog.io-impl": "org.apache.iceberg.aws.s3.S3FileIO",
  "iceberg.catalog.s3.endpoint": "http://minio:9000",
  "iceberg.catalog.s3.access-key-id": "minioadmin",
  "iceberg.catalog.s3.secret-access-key": "minioadmin",
  "iceberg.catalog.s3.path-style-access": "true"
}
```

When using DebeziumTransform for CDC:

```json
{
  "transforms": "debezium",
  "transforms.debezium.type": "org.apache.iceberg.connect.transforms.DebeziumTransform"
}
```

## Included Modules in Distribution

After adding Nessie, the distribution includes:

- `iceberg-kafka-connect` - Core connector
- `iceberg-kafka-connect-transforms` - SMTs including DebeziumTransform
- `iceberg-aws` - S3FileIO, Glue catalog
- `iceberg-gcp` - GCS support
- `iceberg-azure` - Azure Data Lake support
- `iceberg-nessie` - Nessie catalog (after modification)
- `iceberg-parquet` - Parquet file format
- `iceberg-orc` - ORC file format

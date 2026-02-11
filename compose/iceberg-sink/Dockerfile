# Apache Iceberg Kafka Connect sink
# Build from source since no pre-built uber-jar is available
#
# SETUP: Cache Iceberg source and Gradle locally (both gitignored):
#   cd compose/iceberg-sink/cache
#   git clone --depth 1 --branch apache-iceberg-1.9.2 https://github.com/apache/iceberg.git iceberg
#   echo "1.9.2" > iceberg/version.txt  # Required for version detection without .git
#   mkdir -p gradle && curl -L -O https://services.gradle.org/distributions/gradle-8.13-bin.zip
#
FROM eclipse-temurin:17-jdk AS builder

ARG ICEBERG_VERSION=1.9.2
ARG GRADLE_VERSION=8.13

# Install unzip for extracting the distribution
RUN apt-get update && apt-get install -y unzip

# Copy and install pre-downloaded Gradle from host (avoids 130MB download every build)
COPY cache/gradle/gradle-${GRADLE_VERSION}-bin.zip /tmp/gradle.zip
RUN mkdir -p /opt/gradle && \
    unzip -q /tmp/gradle.zip -d /opt/gradle && \
    rm /tmp/gradle.zip
ENV PATH="/opt/gradle/gradle-${GRADLE_VERSION}/bin:${PATH}"

# Copy pre-downloaded Iceberg source from host
COPY cache/iceberg /iceberg

WORKDIR /iceberg

# Build the Kafka Connect distribution (skip tests for faster build)
# Use system Gradle instead of wrapper to skip download
RUN gradle :iceberg-kafka-connect:iceberg-kafka-connect-runtime:distZip -x test -x integrationTest

# Unzip the distribution
RUN cd kafka-connect/kafka-connect-runtime/build/distributions && \
    unzip iceberg-kafka-connect-runtime-${ICEBERG_VERSION}.zip

# Final image with Confluent Kafka Connect
FROM confluentinc/cp-kafka-connect:8.1.1

ARG ICEBERG_VERSION=1.9.2

# Copy the built distribution (contains all JARs)
COPY --from=builder /iceberg/kafka-connect/kafka-connect-runtime/build/distributions/iceberg-kafka-connect-runtime-${ICEBERG_VERSION} \
    /usr/share/confluent-hub-components/iceberg-kafka-connect


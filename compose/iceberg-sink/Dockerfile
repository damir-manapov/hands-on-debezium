# Apache Iceberg Kafka Connect sink
# Using Confluent Kafka Connect base with official Apache Iceberg connector from Maven
FROM confluentinc/cp-kafka-connect:8.1.1

# Download Apache Iceberg Kafka Connect runtime JAR from Maven Central
# This is the official Apache Iceberg connector (donated by Tabular)
ARG ICEBERG_VERSION=1.7.1
RUN mkdir -p /usr/share/confluent-hub-components/iceberg-kafka-connect && \
    curl -L -o /usr/share/confluent-hub-components/iceberg-kafka-connect/iceberg-kafka-connect-runtime-${ICEBERG_VERSION}.jar \
    "https://repo1.maven.org/maven2/org/apache/iceberg/iceberg-kafka-connect-runtime/${ICEBERG_VERSION}/iceberg-kafka-connect-runtime-${ICEBERG_VERSION}.jar"

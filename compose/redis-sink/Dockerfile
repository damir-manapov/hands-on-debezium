# Debezium Connect + jcustenborder Redis Sink Connector
# Downloads and installs the Confluent Redis connector plugin
# into the Debezium Kafka Connect image.
FROM debezium/connect:3.0.0.Final

ARG REDIS_CONNECTOR_VERSION=0.0.8

USER root

RUN microdnf install -y unzip && \
    microdnf clean all

# Download and install the jcustenborder Redis connector
RUN curl -fSL -o /tmp/redis-connector.zip \
      "https://d2p6pa21dvn84.cloudfront.net/api/plugins/jcustenborder/kafka-connect-redis/versions/${REDIS_CONNECTOR_VERSION}/jcustenborder-kafka-connect-redis-${REDIS_CONNECTOR_VERSION}.zip" && \
    mkdir -p /kafka/connect/redis-sink && \
    unzip -q /tmp/redis-connector.zip -d /tmp/redis-connector && \
    cp /tmp/redis-connector/jcustenborder-kafka-connect-redis-${REDIS_CONNECTOR_VERSION}/lib/*.jar \
      /kafka/connect/redis-sink/ && \
    rm -rf /tmp/redis-connector /tmp/redis-connector.zip

USER kafka

# Debezium Connect + Confluent Elasticsearch Sink Connector
# Downloads and installs the Confluent Elasticsearch connector plugin
# into the Debezium Kafka Connect image.
FROM debezium/connect:3.0.0.Final

ARG ES_CONNECTOR_VERSION=15.1.1

USER root

RUN microdnf install -y unzip && \
    microdnf clean all

# Download and install the Confluent Elasticsearch connector
RUN curl -fSL -o /tmp/es-connector.zip \
      "https://d2p6pa21dvn84.cloudfront.net/api/plugins/confluentinc/kafka-connect-elasticsearch/versions/${ES_CONNECTOR_VERSION}/confluentinc-kafka-connect-elasticsearch-${ES_CONNECTOR_VERSION}.zip" && \
    mkdir -p /kafka/connect/confluent-elasticsearch-sink && \
    unzip -q /tmp/es-connector.zip -d /tmp/es-connector && \
    cp /tmp/es-connector/confluentinc-kafka-connect-elasticsearch-${ES_CONNECTOR_VERSION}/lib/*.jar \
      /kafka/connect/confluent-elasticsearch-sink/ && \
    rm -rf /tmp/es-connector /tmp/es-connector.zip

USER kafka

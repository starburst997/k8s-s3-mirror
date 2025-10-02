# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM alpine:latest

RUN apk add --no-cache dnsmasq

# Create dnsmasq configuration
RUN echo "address=/s3-proxy/172.20.0.20" > /etc/dnsmasq.conf && \
    echo "server=8.8.8.8" >> /etc/dnsmasq.conf && \
    echo "server=8.8.4.4" >> /etc/dnsmasq.conf && \
    echo "no-resolv" >> /etc/dnsmasq.conf && \
    echo "log-queries" >> /etc/dnsmasq.conf && \
    echo "log-facility=-" >> /etc/dnsmasq.conf

EXPOSE 53/udp 53/tcp

ENTRYPOINT ["dnsmasq", "-k", "--log-facility=-"]
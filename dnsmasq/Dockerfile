# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM alpine:latest

# Install required packages
RUN apk add --no-cache dnsmasq bash

# Copy the startup script
COPY start-dnsmasq.sh /start-dnsmasq.sh

# Make the script executable
RUN chmod +x /start-dnsmasq.sh

EXPOSE 53/udp 53/tcp

ENTRYPOINT ["/start-dnsmasq.sh"]
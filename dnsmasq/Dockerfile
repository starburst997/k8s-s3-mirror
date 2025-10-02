# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM alpine:latest

RUN apk add --no-cache dnsmasq bash

# Create a startup script that configures dnsmasq based on environment variables
RUN cat > /start-dnsmasq.sh << 'EOF'
#!/bin/bash

# Default values
WILDCARD_DOMAIN="${WILDCARD_DOMAIN:-localhost}"
TARGET_IP="${TARGET_IP:-}"
TARGET_HOST="${TARGET_HOST:-}"
UPSTREAM_DNS="${UPSTREAM_DNS:-8.8.8.8 8.8.4.4}"
LOG_QUERIES="${LOG_QUERIES:-yes}"

# Start building config
echo "# Generated dnsmasq configuration" > /etc/dnsmasq.conf

# Configure wildcard domain resolution
if [ -n "$TARGET_IP" ]; then
    echo "address=/${WILDCARD_DOMAIN}/${TARGET_IP}" >> /etc/dnsmasq.conf
    echo "Configured: *.${WILDCARD_DOMAIN} -> ${TARGET_IP}"
elif [ -n "$TARGET_HOST" ]; then
    # Resolve the target host to IP
    TARGET_IP=$(getent hosts ${TARGET_HOST} | awk '{ print $1 }' | head -1)
    if [ -n "$TARGET_IP" ]; then
        echo "address=/${WILDCARD_DOMAIN}/${TARGET_IP}" >> /etc/dnsmasq.conf
        echo "Configured: *.${WILDCARD_DOMAIN} -> ${TARGET_HOST} (${TARGET_IP})"
    else
        echo "ERROR: Could not resolve ${TARGET_HOST}"
        exit 1
    fi
else
    echo "ERROR: Either TARGET_IP or TARGET_HOST must be set"
    exit 1
fi

# Configure upstream DNS servers
for dns in $UPSTREAM_DNS; do
    echo "server=${dns}" >> /etc/dnsmasq.conf
done

# Basic settings
echo "no-resolv" >> /etc/dnsmasq.conf
echo "no-hosts" >> /etc/dnsmasq.conf

# Optional query logging
if [ "$LOG_QUERIES" = "yes" ]; then
    echo "log-queries" >> /etc/dnsmasq.conf
    echo "log-facility=-" >> /etc/dnsmasq.conf
fi

echo "Starting dnsmasq with configuration:"
cat /etc/dnsmasq.conf

exec dnsmasq -k --log-facility=-
EOF

RUN chmod +x /start-dnsmasq.sh

EXPOSE 53/udp 53/tcp

ENTRYPOINT ["/start-dnsmasq.sh"]
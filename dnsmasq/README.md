# Docker Wildcard DNS Resolver

A simple, configurable dnsmasq container that enables wildcard subdomain resolution in Docker Compose environments.

## Quick Start

Add this to any `docker-compose.yml` to enable wildcard DNS:

```yaml
services:
  dnsmasq:
    build: ./dnsmasq  # Or use image: your-registry/wildcard-dns
    environment:
      WILDCARD_DOMAIN: myapp      # *.myapp will resolve to 'myapp' service
    cap_add:
      - NET_ADMIN
    networks:
      default:
        ipv4_address: 172.20.0.253  # Fixed IP for DNS
    restart: unless-stopped

  # Your service that needs wildcard subdomains (name matches WILDCARD_DOMAIN)
  myapp:
    image: your-app
    # ... your config ...

  # Client services that need to resolve wildcards
  client:
    image: some-client
    dns: 172.20.0.253  # Point to dnsmasq IP
    # ... rest of config ...

networks:
  default:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

## Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `WILDCARD_DOMAIN` | Domain for wildcard resolution | `localhost` | `s3-proxy` |
| `TARGET_HOST` | Service name to resolve to | Same as `WILDCARD_DOMAIN` | `my-service` |
| `TARGET_IP` | IP address to resolve to (alternative to TARGET_HOST) | - | `172.20.0.20` |
| `UPSTREAM_DNS` | Upstream DNS servers | `8.8.8.8 8.8.4.4` | `1.1.1.1` |
| `LOG_QUERIES` | Enable DNS query logging | `yes` | `no` |

**Note:** `TARGET_HOST` defaults to `WILDCARD_DOMAIN` if not specified, which works for most cases where the service name matches the domain name.

## Use Cases

### 1. S3-Compatible Storage (MinIO, S3 Proxy)

For services that need virtual-host style bucket access:

```yaml
services:
  dnsmasq:
    build: ./dnsmasq
    environment:
      WILDCARD_DOMAIN: minio
      TARGET_HOST: minio
    cap_add:
      - NET_ADMIN

  minio:
    image: minio/minio
    # Now bucket.minio will resolve to minio service

  app:
    image: your-app
    dns: dnsmasq
    # Can use bucket.minio URLs
```

### 2. Multi-Tenant Applications

For SaaS apps where each tenant gets a subdomain:

```yaml
services:
  dnsmasq:
    build: ./dnsmasq
    environment:
      WILDCARD_DOMAIN: app.local
      TARGET_HOST: webapp
    cap_add:
      - NET_ADMIN

  webapp:
    image: your-webapp
    # tenant1.app.local, tenant2.app.local all resolve here
```

### 3. Development Environments

For local development with multiple subdomains:

```yaml
services:
  dnsmasq:
    build: ./dnsmasq
    environment:
      WILDCARD_DOMAIN: dev.local
      TARGET_HOST: nginx
    cap_add:
      - NET_ADMIN

  nginx:
    image: nginx
    # api.dev.local, admin.dev.local, etc.
```

## How It Works

1. dnsmasq intercepts DNS queries from containers using it as their DNS server
2. Any query matching `*.${WILDCARD_DOMAIN}` returns the IP of `${TARGET_HOST}`
3. All other queries are forwarded to upstream DNS servers

## Building the Image

```bash
cd dnsmasq
docker build -t wildcard-dns .
```

## Testing

Test DNS resolution from any container:

```bash
# From a container using dnsmasq for DNS
docker-compose exec your-service sh -c "nslookup test.yourdomain"
```

## Minimal Setup

The absolute minimum you need to add wildcard DNS to any project:

1. Copy the `dnsmasq/` folder to your project
2. Add to docker-compose.yml:

```yaml
services:
  dnsmasq:
    build: ./dnsmasq
    environment:
      WILDCARD_DOMAIN: your-service  # Both domain and target service
    cap_add:
      - NET_ADMIN
    networks:
      default:
        ipv4_address: 172.20.0.253

  your-service:  # Service name matches WILDCARD_DOMAIN
    image: your-image
    # ... your config ...

  # Any service that needs to resolve wildcards:
  client:
    dns: 172.20.0.253

networks:
  default:
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

That's it! Now `*.your-service` resolves to the `your-service` container.

## Note on Docker Compose DNS

Docker Compose requires DNS servers to be specified as IP addresses, not service names. That's why we need:
1. A fixed IP for the dnsmasq service (`172.20.0.253`)
2. A defined network subnet (`172.20.0.0/16`)
3. Client services to reference the DNS server by IP (`dns: 172.20.0.253`)

The IP `172.20.0.253` was chosen as it's typically unused and at the end of the subnet range.
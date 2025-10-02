# Test Environment

This directory contains the Docker Compose test environment for the K8S S3 Mirror proxy.

## Contents

- **docker-compose.yml** - Test environment configuration with proxy, PostgreSQL, and test client
- **test-client/** - Node.js test client for S3 operations
- **test-files/** - Sample files for testing uploads
- **.env.example** - Example environment configuration
- **.env** - Your actual credentials (not committed to git)

## Quick Start

1. Copy and configure environment:

```bash
cp .env.example .env
# Edit .env with your S3 credentials
```

2. Start the test environment:

```bash
docker compose up --build
```

3. Run tests:

```bash
# Full test suite
docker compose exec test-client node index.js test my-bucket

# Individual operations
docker compose exec test-client node index.js upload my-bucket test.txt /test-files/sample.txt
docker compose exec test-client node index.js list my-bucket
docker compose exec test-client node index.js download my-bucket test.txt /tmp/test.txt
docker compose exec test-client node index.js delete my-bucket test.txt
```

## Services

- **s3-proxy** - The main proxy service (port 8080)
- **postgres** - PostgreSQL for file tracking (port 5432)
- **dnsmasq** - Wildcard DNS for virtual-host style S3 (\*.s3-proxy)
- **test-client** - Node.js client for testing

## Notes

- The proxy supports both path-style and virtual-host style S3 requests
- Files are tracked in PostgreSQL (one database per bucket)
- DNS wildcard resolution enables `bucket.s3-proxy` addresses

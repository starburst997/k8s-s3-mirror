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
# Full test suite (virtual-hosted style)
docker compose exec test-client node index.js test my-bucket

# Test both path-style and virtual-hosted style
docker compose exec test-client node index.js test-styles my-bucket

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

## S3 Request Styles

The proxy fully supports **both** S3 request styles:

### Virtual-Hosted Style (Default)
- Format: `http://bucket.s3-proxy/object-key`
- Bucket name is in the hostname subdomain
- Used by AWS SDK by default
- Requires DNS wildcard support (provided by dnsmasq)

### Path-Style
- Format: `http://s3-proxy/bucket/object-key`
- Bucket name is in the URL path
- More compatible with simple setups
- Enable in AWS SDK with `forcePathStyle: true`

Example configuration for path-style:
```javascript
const s3Client = new S3Client({
  endpoint: "http://s3.local",
  forcePathStyle: true,  // Use path-style
  credentials: { ... }
})
```

## Notes

- Files are tracked in PostgreSQL (one table per bucket)
- DNS wildcard resolution enables `bucket.s3-proxy` addresses for virtual-hosted style
- Path-style works with any hostname (no DNS wildcard needed)

# K8S S3 Mirror - Technical Documentation

## Project Overview

A Kubernetes-native S3 proxy that intercepts S3 requests, forwards them to the main S3 service, and asynchronously mirrors operations to a backup S3 while maintaining a PostgreSQL inventory.

## Architecture

### Design Philosophy

The proxy follows a simple, efficient design:

- **HTTP internally**: Apps communicate with the proxy over HTTP (internal K8s traffic)
- **HTTPS externally**: Proxy communicates with S3 endpoints over HTTPS
- **Centralized auth**: All S3 credentials are managed by the proxy, not individual apps
- **Async operations**: Database logging and mirroring happen in the background

### Request Flow

1. **Application** → HTTP → **Proxy** (inside K8s cluster)
2. **Proxy** authenticates and forwards → HTTPS → **Main S3**
3. **Proxy** (async) → logs to **PostgreSQL**
4. **Proxy** (async) → mirrors to **Backup S3**

## Key Design Decisions

1. **HTTP internally, HTTPS externally**: Simplified internal traffic, no TLS certificate management
2. **Proxy handles all S3 auth**: Centralized credentials, apps don't need S3 keys
3. **One table per bucket**: Better performance and isolation
4. **Async mirroring**: Non-blocking operations for minimal latency
5. **Soft deletes in DB**: Tracks deletions without losing history
6. **Dual request style support**: Handles both path-style (`/bucket/key`) and virtual-hosted (`bucket.domain/key`) S3 requests

## Implementation Details

### Core Proxy Logic (`main.go`)

The proxy is implemented in Go for performance:

```go
func handleProxyRequest(w http.ResponseWriter, req *http.Request, targetURL *url.URL) {
    // 1. Read request body
    bodyBytes, _ := io.ReadAll(req.Body)

    // 2. Create new request with main S3 credentials
    forwardReq := createSignedRequest(mainAccessKey, mainSecretKey)

    // 3. Forward to main S3
    resp := client.Do(forwardReq)

    // 4. Return response to app
    w.WriteHeader(resp.StatusCode)
    w.Write(respBody)

    // 5. Async operations (non-blocking)
    go func() {
        logToDatabase(bucket, key, metadata)
        mirrorToBackupS3(bucket, key, body)
    }()
}
```

### S3 Signature Handling

The proxy implements AWS Signature Version 4 for authenticating with S3 endpoints:

- Signs requests with appropriate credentials (main or mirror)
- Handles both path-style and virtual-hosted-style requests
- Preserves necessary headers while forwarding

### Database Management

- **Dynamic DB creation**: Creates a database for each bucket on first access
- **Connection pooling**: Maintains connection pool per bucket
- **Efficient updates**: Uses UPSERT for file tracking
- **Soft deletes**: Marks files as deleted rather than removing records

## Required Environment Variables

```bash
MAIN_S3_ENDPOINT    # Main S3 endpoint (default: https://s3.amazonaws.com)
MAIN_ACCESS_KEY     # Required: Main S3 access key
MAIN_SECRET_KEY     # Required: Main S3 secret key
MIRROR_S3_ENDPOINT  # Required: Mirror S3 endpoint
MIRROR_ACCESS_KEY   # Required: Mirror S3 access key
MIRROR_SECRET_KEY   # Required: Mirror S3 secret key
POSTGRES_URL        # Required: PostgreSQL connection string
LOG_LEVEL           # Optional: debug/info/warn/error/off (default: info)
```

## Database Schema

Each bucket gets its own database `s3_mirror_<bucket_name>` with:

```sql
CREATE TABLE files (
    id SERIAL PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    size BIGINT NOT NULL,
    content_type TEXT NOT NULL,
    is_backed_up BOOLEAN DEFAULT FALSE,
    last_modified TIMESTAMP NOT NULL,
    deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

## Project Structure

```
/
├── main.go              # Core proxy server implementation
├── Dockerfile           # Container build configuration
├── go.mod / go.sum      # Go dependencies
└── helm/s3-mirror/      # Helm chart for deployment
    ├── Chart.yaml
    ├── values.yaml
    └── templates/
```

## Key Functions in main.go

### `handleProxyRequest()`

Main request handler that:

1. Reads incoming request body
2. Signs request with main S3 credentials
3. Forwards to main S3
4. Returns response to client
5. Triggers async operations (DB log + mirror)

### `signRequestV4()`

Implements AWS Signature V4 for authenticating requests to S3 endpoints.

### `mirrorToBackupS3()`

Async function that replicates operations to backup S3 with proper authentication.

### `getOrCreateBucketDB()`

Dynamically creates PostgreSQL database for each bucket on first access.

### `extractBucketAndKey()`

Parses S3 requests to extract bucket name and object key, supporting both:

- **Path-style**: `/bucket-name/object-key` - bucket in URL path
- **Virtual-hosted style**: `bucket-name.endpoint/object-key` - bucket in hostname

The function intelligently detects the request style:
- Checks if the path contains the bucket name (path-style)
- Checks if hostname has a bucket subdomain (virtual-hosted)
- Filters out common service names (`s3`, `localhost`, `minio`, etc.) to avoid false positives

## Important Implementation Notes

1. **No TLS complexity**: Service runs on HTTP port 8080 internally
2. **Async operations**: DB writes and mirroring are non-blocking (goroutines)
3. **Database naming**: Bucket names sanitized with regex for table names
4. **Soft deletes**: DELETE operations mark `deleted=true` in DB, don't remove records
5. **Region hardcoded**: Currently uses `us-east-1` for signature - could be made configurable
6. **Dual S3 styles**: Supports both path-style and virtual-hosted style automatically

## Known Limitations

- Multipart uploads work but aren't individually tracked in DB
- No support for S3 object versioning yet
- Region is hardcoded to `us-east-1` in signature
- No request validation or filtering
- No built-in retry mechanism for failed mirrors

## Testing Locally

```bash
# Quick test with curl
curl -X PUT http://localhost:8080/test-bucket/test.txt \
  -H "Content-Type: text/plain" \
  -d "Hello World"

# Check database
psql $POSTGRES_URL
\c s3_mirror_test_bucket
SELECT * FROM files;
```

# K8S S3 Mirror

![Build Status](https://github.com/starburst997/k8s-s3-mirror/workflows/Build%20and%20Publish/badge.svg)
![License](https://img.shields.io/github/license/starburst997/k8s-s3-mirror)
![Go Version](https://img.shields.io/badge/Go-1.21-blue)

A high-performance Kubernetes-native S3 proxy that provides real-time mirroring and database tracking. Perfect for disaster recovery, cost optimization, and S3 usage analytics.

## Features

- **Simple Integration**: Just point your S3 client to the proxy endpoint
- **Real-time Mirroring**: Automatically mirrors S3 operations to a backup S3-compatible storage
- **Database Tracking**: Maintains a PostgreSQL inventory of all files for cost-effective operations
- **High Performance**: Written in Go with minimal overhead (~2-3ms per request)
- **Kubernetes Native**: Easy deployment with Helm charts
- **Cost Optimization**: Eliminates expensive LIST operations for backup synchronization
- **Multi-Cloud Support**: Works with ANY S3-compatible storage (AWS S3, Backblaze B2, Wasabi, MinIO, etc.)

## Table of Contents

- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Installation](#installation)
  - [Using Helm](#using-helm)
  - [Using Kubernetes Manifests](#using-kubernetes-manifests)
- [Configuration](#configuration)
- [Application Integration](#application-integration)
- [Database Schema](#database-schema)
- [Monitoring](#monitoring)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   Your App  │─────▶│  S3 Proxy    │─────▶│   Main S3   │
│             │ HTTP │   (This)     │ HTTPS│   (Any S3)  │
└─────────────┘      │              │      └─────────────┘
                     │              │
                     │              │──────▶┌─────────────┐
                     │              │ HTTPS │  Mirror S3  │
                     │              │       │ (B2/Wasabi) │
                     │              │       └─────────────┘
                     │              │
                     │              │──────▶┌─────────────┐
                     └──────────────┘       │  PostgreSQL │
                                            │  (Inventory)│
                                            └─────────────┘
```

How it works:

1. Your app connects to the proxy via simple HTTP (internal K8s traffic)
2. The proxy authenticates and forwards requests to your main S3 over HTTPS
3. Successful operations are asynchronously:
   - Logged to PostgreSQL (one database per bucket)
   - Mirrored to backup S3-compatible storage

## Quick Start

### Prerequisites

- Kubernetes cluster (1.19+)
- PostgreSQL instance
- S3-compatible storage for mirroring (Backblaze B2, Wasabi, MinIO, etc.)
- Helm 3 (optional but recommended)

### Installation

#### Using Helm

1. Add the Helm repository:

```bash
helm repo add k8s-s3-mirror https://starburst997.github.io/k8s-s3-mirror/charts
helm repo update
```

2. Create a values file (`my-values.yaml`):

```yaml
s3:
  # Your main S3 endpoint and credentials
  mainEndpoint: "https://s3.amazonaws.com"
  mainAccessKey: "your-aws-access-key"
  mainSecretKey: "your-aws-secret-key"

  # Your backup S3 endpoint and credentials
  mirrorEndpoint: "https://s3.us-west-000.backblazeb2.com"
  mirrorAccessKey: "your-b2-access-key"
  mirrorSecretKey: "your-b2-secret-key"

postgresql:
  url: "postgres://user:password@postgres:5432/s3_mirror"
```

3. Install the chart:

```bash
helm install s3-mirror k8s-s3-mirror/s3-mirror \
  --namespace s3-mirror \
  --create-namespace \
  -f my-values.yaml
```

#### Using Kubernetes Manifests

1. Clone the repository:

```bash
git clone https://github.com/starburst997/k8s-s3-mirror
cd k8s-s3-mirror
```

2. Update the configuration files:

```bash
# Edit k8s/secret.yaml with your credentials
vim k8s/secret.yaml

# Edit k8s/configmap.yaml with your S3 endpoints
vim k8s/configmap.yaml
```

3. Deploy to Kubernetes:

```bash
kubectl apply -f k8s/
```

## Deployment Patterns

### Pattern 1: Shared Proxy (Recommended)

Deploy one S3 proxy instance that multiple applications share. This is the most resource-efficient approach.

```yaml
# All apps point to: http://s3-proxy.s3-mirror.svc.cluster.local
```

### Pattern 2: Sidecar Proxy

Each application gets its own S3 proxy and PostgreSQL database. This provides complete isolation but uses more resources.

#### Kubernetes Sidecar Example

See [`examples/sidecar-deployment.yaml`](examples/sidecar-deployment.yaml) for a complete example that includes:
- Application container
- S3 proxy sidecar
- PostgreSQL container
- Persistent volume for database
- All in a single pod

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
        # Your application
        - name: app
          image: your-app:latest
          env:
            - name: S3_ENDPOINT
              value: "http://localhost:8080"  # Local proxy

        # S3 Proxy sidecar
        - name: s3-proxy
          image: ghcr.io/starburst997/k8s-s3-mirror:latest
          env:
            - name: POSTGRES_URL
              value: "postgres://user:pass@localhost:5432/s3_mirror"
            # ... other env vars

        # PostgreSQL
        - name: postgres
          image: postgres:15-alpine
          volumeMounts:
            - name: postgres-storage
              mountPath: /var/lib/postgresql/data

      volumes:
        - name: postgres-storage
          persistentVolumeClaim:
            claimName: myapp-postgres-pvc
```

#### Benefits of Sidecar Pattern:
- **Complete isolation**: Each app has its own proxy and database
- **Independent scaling**: Scale apps independently
- **Fault isolation**: Issues in one app don't affect others
- **Custom configuration**: Per-app S3 settings and bucket prefixes
- **Network locality**: Communication via localhost is faster

#### Drawbacks:
- **Resource overhead**: Each app needs 3 containers
- **Complex management**: More components to monitor
- **Database per app**: Higher storage costs

#### Simplified Sidecar (No Database)

For even simpler deployments, you can disable database tracking entirely:

```yaml
env:
  - name: DISABLE_DATABASE
    value: "true"
```

This mode:
- ✅ Still mirrors to backup S3
- ✅ Uses less resources (no PostgreSQL needed)
- ✅ Simpler deployment
- ❌ No file inventory tracking
- ❌ No backup status monitoring

See [`examples/sidecar-simple.yaml`](examples/sidecar-simple.yaml) for a complete example.

#### Docker Compose Sidecar Example

For local development, see [`examples/docker-compose-sidecar.yml`](examples/docker-compose-sidecar.yml):

```bash
cd examples
docker-compose -f docker-compose-sidecar.yml up
```

## Application Integration

Simply update your S3 client configuration to point to the proxy service. The only changes needed:

1. Change endpoint to `http://s3-proxy.s3-mirror.svc.cluster.local`
2. Remove AWS credentials (proxy handles authentication)
3. Enable path-style addressing (`forcePathStyle: true`)

### Node.js Example

```javascript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

// Before: pointing to S3 directly
// const s3 = new S3Client({
//   region: "us-east-1",
//   credentials: { ... }
// })

// After: pointing to the proxy
const s3 = new S3Client({
  endpoint: "http://s3-proxy.s3-mirror.svc.cluster.local",
  region: "us-east-1", // Still needed for SDK
  forcePathStyle: true, // Important for proxy
  // No credentials needed - proxy handles auth
})

// Your code remains the same!
await s3.send(
  new PutObjectCommand({
    Bucket: "my-bucket",
    Key: "file.txt",
    Body: "Hello World",
  })
)
```

### Python Example (boto3)

```python
import boto3

# Point to the proxy instead of S3
s3 = boto3.client(
    's3',
    endpoint_url='http://s3-proxy.s3-mirror.svc.cluster.local',
    # No credentials needed - proxy handles auth
)

# Your code remains the same!
s3.put_object(Bucket='my-bucket', Key='file.txt', Body=b'Hello World')
```

### Go Example

```go
import (
    "github.com/aws/aws-sdk-go/aws"
    "github.com/aws/aws-sdk-go/aws/session"
    "github.com/aws/aws-sdk-go/service/s3"
)

// Point to the proxy
sess := session.Must(session.NewSession(&aws.Config{
    Endpoint:         aws.String("http://s3-proxy.s3-mirror.svc.cluster.local"),
    Region:           aws.String("us-east-1"),
    S3ForcePathStyle: aws.Bool(true),
    // No credentials needed - proxy handles auth
}))

svc := s3.New(sess)
// Your code remains the same!
```

## Configuration

### Environment Variables

| Variable             | Description                               | Default                    |
| -------------------- | ----------------------------------------- | -------------------------- |
| `MAIN_S3_ENDPOINT`   | Primary S3 endpoint                       | `https://s3.amazonaws.com` |
| `MAIN_ACCESS_KEY`    | Primary S3 access key                     | Required                   |
| `MAIN_SECRET_KEY`    | Primary S3 secret key                     | Required                   |
| `MIRROR_S3_ENDPOINT`    | Mirror S3 endpoint                                   | Required                   |
| `MIRROR_ACCESS_KEY`     | Mirror S3 access key                                 | Required                   |
| `MIRROR_SECRET_KEY`     | Mirror S3 secret key                                 | Required                   |
| `MIRROR_BUCKET_PREFIX`  | Optional prefix for mirror bucket names (e.g. "mirror-") | Empty (no prefix)      |
| `POSTGRES_URL`          | PostgreSQL connection string                         | Required (unless disabled) |
| `POSTGRES_HOST`         | PostgreSQL host (alternative to POSTGRES_URL)        | `localhost`                |
| `POSTGRES_PORT`         | PostgreSQL port                                      | `5432`                     |
| `POSTGRES_USER`         | PostgreSQL username                                  | `s3mirror`                 |
| `POSTGRES_PASSWORD`     | PostgreSQL password                                  | Required (if not using URL)|
| `POSTGRES_DB`           | PostgreSQL database name                             | `s3_mirror`                |
| `POSTGRES_SSLMODE`      | PostgreSQL SSL mode                                  | `disable`                  |
| `DISABLE_DATABASE`      | Disable database tracking (mirror-only mode)         | `false`                    |
| `LOG_LEVEL`             | Logging level (debug/info/warn/error/off)            | `info`                     |

### Bucket Prefix for Mirroring

The `MIRROR_BUCKET_PREFIX` environment variable allows you to automatically prefix bucket names when mirroring to the backup S3. This is useful when:

- You want to distinguish mirrored buckets from original ones
- Your mirror S3 provider has naming requirements
- You need to avoid bucket name conflicts

**Example:**
- If `MIRROR_BUCKET_PREFIX=mirror-`
- Main bucket: `my-data`
- Mirror bucket: `mirror-my-data`

This happens transparently - your applications don't need to know about the prefix.

### Service Endpoints

The proxy exposes a simple HTTP endpoint within your Kubernetes cluster:

- **Service Name**: `s3-proxy.s3-mirror.svc.cluster.local`
- **Port**: 80 (HTTP)
- **Protocol**: HTTP (internal K8s traffic is already encrypted at the network level)

No TLS/HTTPS configuration needed - the proxy handles secure connections to the actual S3 endpoints.

## Database Schema

The proxy uses a single PostgreSQL database with one table per S3 bucket. Table names are automatically generated as `bucket_<bucketname>` (with special characters replaced by underscores).

```sql
-- Example: For bucket "my-data", the table would be "bucket_my_data"
CREATE TABLE bucket_my_data (
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

-- Indexes for performance
CREATE INDEX idx_bucket_my_data_path ON bucket_my_data(path);
CREATE INDEX idx_bucket_my_data_backup ON bucket_my_data(is_backed_up);
CREATE INDEX idx_bucket_my_data_deleted ON bucket_my_data(deleted);
```

### Table Naming Convention
- Bucket names are prefixed with `bucket_`
- Special characters are replaced with underscores
- Examples:
  - `my-data` → `bucket_my_data`
  - `user.files` → `bucket_user_files`
  - `backup-2024` → `bucket_backup_2024`

### Useful Queries

```sql
-- List all bucket tables
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'bucket_%';

-- Files not yet backed up (replace bucket_my_data with your table)
SELECT * FROM bucket_my_data
WHERE is_backed_up = FALSE AND deleted = FALSE;

-- Total storage size for a bucket
SELECT SUM(size) as total_bytes
FROM bucket_my_data WHERE deleted = FALSE;

-- Files by type for a bucket
SELECT content_type, COUNT(*), SUM(size) as total_size
FROM bucket_my_data WHERE deleted = FALSE
GROUP BY content_type;

-- Check all buckets backup status (PostgreSQL 9.4+)
SELECT
    tablename AS bucket,
    (SELECT COUNT(*) FROM public.tablename WHERE NOT is_backed_up) as pending_backup,
    (SELECT COUNT(*) FROM public.tablename WHERE deleted) as deleted_files
FROM pg_tables
WHERE schemaname = 'public' AND tablename LIKE 'bucket_%';
```

## Monitoring

### Health Checks

The proxy exposes health checks on port 8080:

- Liveness: TCP socket check
- Readiness: TCP socket check

### Metrics and Logging

The proxy logs all operations in JSON format:

```json
{
  "level": "info",
  "time": "2024-01-01T12:00:00Z",
  "bucket": "my-bucket",
  "key": "file.txt",
  "method": "PUT",
  "size": 1024,
  "mirror_status": "success"
}
```

### Prometheus Metrics (Coming Soon)

Future versions will expose metrics at `/metrics`:

- `s3_proxy_requests_total`
- `s3_proxy_request_duration_seconds`
- `s3_proxy_mirror_errors_total`
- `s3_proxy_db_errors_total`

## Development

### Local Testing with Docker Compose

The easiest way to test the S3 proxy locally is using Docker Compose, which sets up:
- PostgreSQL database
- S3 Proxy service
- MinIO (local S3-compatible storage)
- Node.js test client

#### Quick Start

1. **Clone the repository:**
```bash
git clone https://github.com/starburst997/k8s-s3-mirror
cd k8s-s3-mirror
```

2. **Copy environment file and update credentials (optional):**
```bash
cp .env.example .env
# Edit .env with your actual S3 credentials, or use MinIO for fully local testing
```

3. **Build and start the services:**
```bash
docker-compose up --build
```

4. **Run tests using the test client:**
```bash
# Run the full test suite
docker-compose exec test-client node index.js test my-test-bucket

# Or run individual commands:
# Upload a file
docker-compose exec test-client node index.js upload my-bucket test.txt /test-files/sample.txt

# List files
docker-compose exec test-client node index.js list my-bucket

# Download a file
docker-compose exec test-client node index.js download my-bucket test.txt /tmp/downloaded.txt

# Delete a file
docker-compose exec test-client node index.js delete my-bucket test.txt
```

5. **Check the logs:**
```bash
# View proxy logs (with debug level enabled)
docker-compose logs -f s3-proxy

# View PostgreSQL to verify database creation
docker-compose exec postgres psql -U s3mirror -d s3_mirror -c "\l"
```

6. **Access MinIO console (if using MinIO for testing):**
- URL: http://localhost:9001
- Username: minioadmin
- Password: minioadmin

#### Using MinIO for Fully Local Testing

To test without any external S3 services, configure both main and mirror to use MinIO:

1. Update your `.env` file:
```bash
MAIN_S3_ENDPOINT=http://minio:9000
MAIN_ACCESS_KEY=minioadmin
MAIN_SECRET_KEY=minioadmin
MIRROR_S3_ENDPOINT=http://minio:9000
MIRROR_ACCESS_KEY=minioadmin
MIRROR_SECRET_KEY=minioadmin
```

2. Create buckets in MinIO:
```bash
# Access MinIO console at http://localhost:9001
# Create two buckets: 'main-bucket' and 'mirror-bucket'
```

3. Run tests:
```bash
docker-compose exec test-client node index.js test main-bucket
```

#### Test Client CLI Commands

The test client (`test-client/index.js`) provides the following commands:

```bash
# Upload a file
node index.js upload <bucket> <key> <file>

# Download a file
node index.js download <bucket> <key> <output>

# Delete a file
node index.js delete <bucket> <key>

# List files in bucket
node index.js list <bucket> [prefix]

# Run full test suite
node index.js test <bucket>
```

#### Verifying the Mirror Works

1. Upload a file through the proxy:
```bash
docker-compose exec test-client node index.js upload test-bucket myfile.txt /test-files/sample.txt
```

2. Check PostgreSQL for the file record:
```bash
docker-compose exec postgres psql -U s3mirror -d s3_mirror_test_bucket -c "SELECT * FROM files;"
```

3. Verify the file exists in both main and mirror S3 (check your S3 consoles or use AWS CLI)

### Building from Source

```bash
# Clone the repository
git clone https://github.com/starburst997/k8s-s3-mirror
cd k8s-s3-mirror

# Install dependencies
go mod download

# Run tests
go test ./...

# Build binary
go build -o s3-proxy .

# Build Docker image
docker build -t k8s-s3-mirror:local .
```

### Running Locally

```bash
# Set environment variables
export MIRROR_S3_ENDPOINT="https://s3.us-west-000.backblazeb2.com"
export MIRROR_ACCESS_KEY="your-key"
export MIRROR_SECRET_KEY="your-secret"
export POSTGRES_URL="postgres://user:pass@localhost/s3_mirror"

# Run the proxy
./s3-proxy
```

### Testing with MinIO

```bash
# Start MinIO for testing
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"

# Configure proxy to use MinIO as mirror
export MIRROR_S3_ENDPOINT="http://localhost:9000"
export MIRROR_ACCESS_KEY="minioadmin"
export MIRROR_SECRET_KEY="minioadmin"
```

## Performance

- **Proxy Overhead**: ~2-3ms per request
- **Memory Usage**: ~10-50MB per pod
- **Concurrent Connections**: 50,000+ per pod
- **Throughput**: Limited by network bandwidth, not CPU

The proxy adds minimal overhead since it streams data directly between your app and S3, with background operations handled asynchronously.

## Troubleshooting

### Common Issues

1. **Connection refused**: Ensure the service name is correct: `s3-proxy.s3-mirror.svc.cluster.local`
2. **Authentication errors**: Check that main S3 credentials are correctly configured in the secret
3. **Database connection**: Verify PostgreSQL connectivity and credentials
4. **Mirror failures**: Check mirror S3 credentials and endpoint
5. **Path-style vs Virtual-host**: Ensure `forcePathStyle: true` is set in your S3 client

### Logging & Disk Usage

The proxy logs to stdout/stderr, which Kubernetes captures. To prevent disk space issues:

#### Option 1: Disable Logging Completely

```yaml
# In your deployment or values.yaml
env:
  - name: LOG_LEVEL
    value: "off"
```

#### Option 2: Log Errors Only

```yaml
env:
  - name: LOG_LEVEL
    value: "error" # Only log errors and fatal issues
```

#### Option 3: Configure Log Rotation in Kubernetes

Configure your container runtime or logging driver to rotate logs automatically. For example, with Docker:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

**Log Levels Available:**

- `debug` - Verbose logging including all operations
- `info` - Standard logging (default)
- `warn` - Warnings and above
- `error` - Errors and fatal only
- `off` - Disable all logging except panics

## Roadmap

- [ ] Prometheus metrics endpoint
- [ ] Web UI for monitoring and management
- [ ] Batch retry for failed mirror operations
- [ ] Support for S3 object versioning
- [ ] Encryption at rest for database
- [ ] Multi-region support
- [ ] Object lifecycle policies
- [ ] S3 event notifications

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with Go for performance and simplicity
- Inspired by the need for cost-effective S3 backup solutions
- Thanks to the Kubernetes and S3 communities

## Support

For issues, questions, or contributions, please:

- Open an [issue](https://github.com/starburst997/k8s-s3-mirror/issues)
- Start a [discussion](https://github.com/starburst997/k8s-s3-mirror/discussions)
- Submit a [pull request](https://github.com/starburst997/k8s-s3-mirror/pulls)

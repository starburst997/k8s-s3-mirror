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
| `MIRROR_S3_ENDPOINT` | Mirror S3 endpoint                        | Required                   |
| `MIRROR_ACCESS_KEY`  | Mirror S3 access key                      | Required                   |
| `MIRROR_SECRET_KEY`  | Mirror S3 secret key                      | Required                   |
| `POSTGRES_URL`       | PostgreSQL connection string              | Required                   |
| `LOG_LEVEL`          | Logging level (debug/info/warn/error/off) | `info`                     |

### Service Endpoints

The proxy exposes a simple HTTP endpoint within your Kubernetes cluster:

- **Service Name**: `s3-proxy.s3-mirror.svc.cluster.local`
- **Port**: 80 (HTTP)
- **Protocol**: HTTP (internal K8s traffic is already encrypted at the network level)

No TLS/HTTPS configuration needed - the proxy handles secure connections to the actual S3 endpoints.

## Database Schema

The proxy creates one PostgreSQL database per S3 bucket with the following schema:

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

-- Indexes for performance
CREATE INDEX idx_files_path ON files(path);
CREATE INDEX idx_files_backup ON files(is_backed_up);
CREATE INDEX idx_files_deleted ON files(deleted);
```

### Useful Queries

```sql
-- Files not yet backed up
SELECT * FROM files WHERE is_backed_up = FALSE AND deleted = FALSE;

-- Total storage size
SELECT SUM(size) as total_bytes FROM files WHERE deleted = FALSE;

-- Files by type
SELECT content_type, COUNT(*), SUM(size) as total_size
FROM files WHERE deleted = FALSE
GROUP BY content_type;
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

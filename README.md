# K8S S3 Mirror

![Build Status](https://github.com/jdboivin/k8s-s3-mirror/workflows/Build%20and%20Publish/badge.svg)
![License](https://img.shields.io/github/license/jdboivin/k8s-s3-mirror)
![Go Version](https://img.shields.io/badge/Go-1.21-blue)

A high-performance Kubernetes-native S3 proxy that provides real-time mirroring and database tracking with zero application code changes. Perfect for disaster recovery, cost optimization, and S3 usage analytics.

## Features

- **Zero Code Changes**: Works with existing `@aws-sdk/client-s3` and other S3 SDKs without modification
- **Real-time Mirroring**: Automatically mirrors S3 operations to a backup S3-compatible storage
- **Database Tracking**: Maintains a PostgreSQL inventory of all files for cost-effective operations
- **High Performance**: Written in Go with minimal overhead
- **Kubernetes Native**: Easy deployment with Helm charts and fixed ClusterIP support
- **Cost Optimization**: Eliminates expensive LIST operations for backup synchronization
- **Multi-Cloud Support**: Works with AWS S3, Backblaze B2, Wasabi, MinIO, and other S3-compatible storage

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
│   Your App  │─────▶│  S3 Proxy    │─────▶│   AWS S3    │
│             │      │   (This)     │      └─────────────┘
└─────────────┘      │              │
                     │              │──────▶┌─────────────┐
                     │              │       │  Mirror S3  │
                     │              │       │ (B2/Wasabi) │
                     │              │       └─────────────┘
                     │              │
                     │              │──────▶┌─────────────┐
                     └──────────────┘       │  PostgreSQL │
                                            │  (Inventory)│
                                            └─────────────┘
```

The proxy intercepts S3 requests transparently using Kubernetes DNS overrides, forwards them to AWS S3, and asynchronously:

1. Logs file metadata to PostgreSQL (one database per bucket)
2. Mirrors the operation to a backup S3-compatible storage

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
helm repo add k8s-s3-mirror https://jdboivin.github.io/k8s-s3-mirror/charts
helm repo update
```

2. Create a values file (`my-values.yaml`):

```yaml
s3:
  mainEndpoint: "https://s3.amazonaws.com"
  mirrorEndpoint: "https://s3.us-west-000.backblazeb2.com"
  mirrorAccessKey: "your-b2-access-key"
  mirrorSecretKey: "your-b2-secret-key"

postgresql:
  url: "postgres://user:password@postgres:5432/s3_mirror"

service:
  clusterIP: 10.96.100.100 # Pick an unused IP in your service CIDR

tls:
  generateSelfSigned: true # For testing; use proper certs in production
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
git clone https://github.com/jdboivin/k8s-s3-mirror
cd k8s-s3-mirror
```

2. Update the configuration files:

```bash
# Edit k8s/secret.yaml with your credentials
vim k8s/secret.yaml

# Edit k8s/configmap.yaml with your endpoints
vim k8s/configmap.yaml

# Update the ClusterIP if needed (must be unused in your cluster)
vim k8s/service.yaml
```

3. Deploy to Kubernetes:

```bash
kubectl apply -f k8s/
```

## Application Integration

To use the proxy with your existing applications, add `hostAliases` to your deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: your-app
spec:
  template:
    spec:
      hostAliases:
        - ip: "10.96.100.100" # The ClusterIP of the s3-proxy service
          hostnames:
            - "s3.amazonaws.com"
            - "s3.us-east-1.amazonaws.com"
            # Add bucket-specific entries if using virtual-host-style:
            - "your-bucket.s3.amazonaws.com"
      containers:
        - name: your-app
          image: your-app:latest
          # No code changes needed! Your S3 client will automatically use the proxy
```

### Example with Node.js

Your existing code remains unchanged:

```javascript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

const s3 = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
})

// This will automatically go through the proxy!
await s3.send(
  new PutObjectCommand({
    Bucket: "my-bucket",
    Key: "file.txt",
    Body: "Hello World",
  })
)
```

## Configuration

### Environment Variables

| Variable             | Description                  | Default                    |
| -------------------- | ---------------------------- | -------------------------- |
| `MAIN_S3_ENDPOINT`   | Primary S3 endpoint          | `https://s3.amazonaws.com` |
| `MIRROR_S3_ENDPOINT` | Mirror S3 endpoint           | Required                   |
| `MIRROR_ACCESS_KEY`  | Mirror S3 access key         | Required                   |
| `MIRROR_SECRET_KEY`  | Mirror S3 secret key         | Required                   |
| `POSTGRES_URL`       | PostgreSQL connection string | Required                   |
| `TLS_CERT_FILE`      | Path to TLS certificate      | `/tmp/server.crt`          |
| `TLS_KEY_FILE`       | Path to TLS private key      | `/tmp/server.key`          |

### TLS Configuration

For production, use proper TLS certificates:

1. Generate a certificate for `s3.amazonaws.com`:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout tls.key -out tls.crt \
  -subj "/CN=s3.amazonaws.com" \
  -addext "subjectAltName=DNS:s3.amazonaws.com,DNS:*.s3.amazonaws.com"
```

2. Create a Kubernetes secret:

```bash
kubectl create secret tls s3-proxy-tls \
  --cert=tls.crt \
  --key=tls.key \
  -n s3-mirror
```

3. Update your Helm values:

```yaml
tls:
  existingSecret: true
  secretName: s3-proxy-tls
  generateSelfSigned: false
```

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

The proxy exposes health checks on port 8443:

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
git clone https://github.com/jdboivin/k8s-s3-mirror
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

### Benchmarks

```bash
# Using hey for load testing
hey -n 10000 -c 100 https://s3-proxy/bucket/test.txt

# Results (example)
Summary:
  Total:        10.2341 secs
  Requests/sec: 977.1234
  Latency:      102.3ms (mean)
  Throughput:   125.4 MB/s
```

## Troubleshooting

### Common Issues

1. **Certificate errors**: Ensure your application trusts the proxy's certificate
2. **DNS resolution**: Verify `hostAliases` are correctly configured
3. **Database connection**: Check PostgreSQL connectivity and credentials
4. **Mirror failures**: Verify mirror S3 credentials and endpoint

### Debug Mode

Enable debug logging:

```yaml
env:
  - name: LOG_LEVEL
    value: "debug"
```

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

- Open an [issue](https://github.com/jdboivin/k8s-s3-mirror/issues)
- Start a [discussion](https://github.com/jdboivin/k8s-s3-mirror/discussions)
- Submit a [pull request](https://github.com/jdboivin/k8s-s3-mirror/pulls)

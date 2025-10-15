# K8S S3 Mirror

![Build Status](https://github.com/starburst997/k8s-s3-mirror/workflows/Production%20Release/badge.svg)
![License](https://img.shields.io/github/license/starburst997/k8s-s3-mirror)
![Go Version](https://img.shields.io/badge/Go-1.21-blue)

A Kubernetes S3 proxy that mirrors operations to backup storage and maintains a PostgreSQL inventory. Useful for disaster recovery, eliminating expensive LIST operations during backups, and tracking S3 usage.

## How It Works

Your application connects to the proxy instead of S3 directly. The proxy forwards requests to your main S3 storage, then asynchronously mirrors to backup storage and optionally logs to PostgreSQL (one table per bucket when configured).

## Quick Start

### Installation with Helm

```bash
# Create values.yaml (minimal configuration without database)
cat > values.yaml <<EOF
s3:
  mainEndpoint: "https://s3.amazonaws.com"
  mainAccessKey: "your-aws-access-key"
  mainSecretKey: "your-aws-secret-key"

  mirrorEndpoint: "https://s3.us-west-000.backblazeb2.com"
  mirrorAccessKey: "your-b2-access-key"
  mirrorSecretKey: "your-b2-secret-key"

# Optional: Add PostgreSQL for inventory tracking
# postgresql:
#   url: "postgres://user:password@postgres:5432/s3_mirror"
EOF

# Install the chart from GitHub Container Registry
helm install s3-mirror oci://ghcr.io/starburst997/charts/s3-mirror \
  --namespace s3-mirror \
  --create-namespace \
  -f values.yaml
```

### Wildcard DNS Setup (For Virtual-Hosted-Style URLs)

If you want to use virtual-hosted-style S3 URLs (e.g., `http://my-bucket.s3.local`), you need to configure wildcard DNS in your cluster:

```bash
# Apply CoreDNS custom configuration
kubectl apply -f examples/kubernetes/coredns-wildcard.yaml

# Restart CoreDNS to load the config
kubectl rollout restart deployment coredns -n kube-system
```

This enables `*.s3.local` to resolve to the s3-mirror service. See [`examples/kubernetes/coredns-wildcard.yaml`](examples/kubernetes/coredns-wildcard.yaml) for the full configuration.

**Note:** If you only need path-style URLs (e.g., `http://s3.local/my-bucket/file.txt`), wildcard DNS is not required.

### Application Integration

Simply update your S3 endpoint - no other changes needed:

```javascript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

const s3 = new S3Client({
  endpoint: "http://s3.local", // The proxy endpoint
  region: "us-east-1",
  // Supports both path-style and virtual-hosted-style requests
})

// Your code remains the same
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

| Variable               | Description                               | Required |
| ---------------------- | ----------------------------------------- | -------- |
| `MAIN_S3_ENDPOINT`     | Primary S3 endpoint                       | Yes      |
| `MAIN_ACCESS_KEY`      | Primary S3 access key                     | Yes      |
| `MAIN_SECRET_KEY`      | Primary S3 secret key                     | Yes      |
| `MIRROR_S3_ENDPOINT`   | Mirror S3 endpoint                        | Yes      |
| `MIRROR_ACCESS_KEY`    | Mirror S3 access key                      | Yes      |
| `MIRROR_SECRET_KEY`    | Mirror S3 secret key                      | Yes      |
| `POSTGRES_URL`         | PostgreSQL connection string\*            | No       |
| `MIRROR_BUCKET_PREFIX` | Prefix for mirror bucket names            | No       |
| `DISABLE_DATABASE`     | Force disable database tracking\*\*       | No       |
| `LOG_LEVEL`            | Logging level (debug/info/warn/error/off) | No       |

\*If not provided, database operations are automatically disabled
\*\*Only needed to disable database when POSTGRES_URL is set

### Deployment Patterns

#### Shared Proxy (Recommended)

Deploy one proxy instance that multiple applications share:

```yaml
# All apps point to: http://s3.local
```

#### Sidecar Pattern

Each application gets its own proxy sidecar.

## Database Schema (Optional)

When PostgreSQL is configured, each bucket gets its own table (`bucket_<bucketname>`) with the following structure:

```sql
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
```

### Useful Queries

```sql
-- Files not yet backed up
SELECT * FROM bucket_my_data
WHERE is_backed_up = FALSE AND deleted = FALSE;

-- Total storage size
SELECT SUM(size) as total_bytes
FROM bucket_my_data WHERE deleted = FALSE;

-- Files by type
SELECT content_type, COUNT(*), SUM(size) as total_size
FROM bucket_my_data WHERE deleted = FALSE
GROUP BY content_type;
```

## Development

### Local Testing with Docker Compose

```bash
git clone https://github.com/starburst997/k8s-s3-mirror
cd k8s-s3-mirror/test

# Configure credentials (optional, can use MinIO for local testing)
cp .env.example .env
vim .env

# Start services
docker compose up --build

# Run tests
docker compose exec test-client node index.js test my-test-bucket
```

### Building from Source

```bash
go mod download
go test ./...
go build -o s3-proxy .
docker build -t k8s-s3-mirror:local .
```

## Monitoring

The proxy exposes health checks on port 8080 and logs all operations in JSON format:

```json
{
  "level": "info",
  "time": "2025-01-01T12:00:00Z",
  "bucket": "my-bucket",
  "key": "file.txt",
  "method": "PUT",
  "size": 1024,
  "mirror_status": "success"
}
```

## Support

For issues or questions, please open an [issue](https://github.com/starburst997/k8s-s3-mirror/issues) on GitHub.

## License

MIT License - see the [LICENSE](LICENSE) file for details.

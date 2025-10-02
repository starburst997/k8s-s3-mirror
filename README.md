# K8S S3 Mirror

![Build Status](https://github.com/starburst997/k8s-s3-mirror/workflows/Build%20and%20Publish/badge.svg)
![Helm Chart](https://github.com/starburst997/k8s-s3-mirror/workflows/Release%20Helm%20Chart/badge.svg)
![License](https://img.shields.io/github/license/starburst997/k8s-s3-mirror)
![Go Version](https://img.shields.io/badge/Go-1.21-blue)

A Kubernetes S3 proxy that mirrors operations to backup storage and maintains a PostgreSQL inventory. Useful for disaster recovery, eliminating expensive LIST operations during backups, and tracking S3 usage.

## How It Works

Your application connects to the proxy instead of S3 directly. The proxy forwards requests to your main S3 storage, then asynchronously mirrors to backup storage and logs to PostgreSQL (one table per bucket).

## Quick Start

### Installation with Helm

```bash
helm repo add k8s-s3-mirror https://starburst997.github.io/k8s-s3-mirror/charts
helm repo update

# Create values.yaml
cat > values.yaml <<EOF
s3:
  mainEndpoint: "https://s3.amazonaws.com"
  mainAccessKey: "your-aws-access-key"
  mainSecretKey: "your-aws-secret-key"

  mirrorEndpoint: "https://s3.us-west-000.backblazeb2.com"
  mirrorAccessKey: "your-b2-access-key"
  mirrorSecretKey: "your-b2-secret-key"

postgresql:
  url: "postgres://user:password@postgres:5432/s3_mirror"
EOF

helm install s3-mirror k8s-s3-mirror/s3-mirror \
  --namespace s3-mirror \
  --create-namespace \
  -f values.yaml
```

### Application Integration

Simply update your S3 endpoint - no other changes needed:

```javascript
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

const s3 = new S3Client({
  endpoint: "http://s3.local",
  region: "us-east-1",
  // No credentials needed - proxy handles auth
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
| `POSTGRES_URL`         | PostgreSQL connection string              | Yes\*    |
| `MIRROR_BUCKET_PREFIX` | Prefix for mirror bucket names            | No       |
| `DISABLE_DATABASE`     | Disable database tracking                 | No       |
| `LOG_LEVEL`            | Logging level (debug/info/warn/error/off) | No       |

\*Not required if `DISABLE_DATABASE=true`

### Deployment Patterns

#### Shared Proxy (Recommended)

Deploy one proxy instance that multiple applications share:

```yaml
# All apps point to: http://s3.local
```

#### Sidecar Pattern

Each application gets its own proxy sidecar. See [`examples/sidecar-deployment.yaml`](examples/sidecar-deployment.yaml) for a complete example.

## Database Schema

Each bucket gets its own table (`bucket_<bucketname>`) with the following structure:

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
docker-compose up --build

# Run tests
docker-compose exec test-client node index.js test my-test-bucket
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

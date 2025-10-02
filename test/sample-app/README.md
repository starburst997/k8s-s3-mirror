# S3 Proxy Test App

Simple web app for testing the S3 proxy functionality in a Kubernetes cluster.

## Features

- Web-based file upload form
- Upload files to S3 (through the proxy)
- List uploaded files
- Minimal dependencies (Express, Multer, AWS SDK)

## Local Development

```bash
# Install dependencies
npm install

# Set environment variables (optional)
export S3_ENDPOINT=http://localhost:8080
export S3_BUCKET=test-bucket

# Run the app
npm start
```

Visit http://localhost:3000

## Docker Build & Run

```bash
# Build image
docker build -t s3-sample-app .

# Run container
docker run -p 3000:3000 \
  -e S3_ENDPOINT=http://host.docker.internal:8080 \
  -e S3_BUCKET=test-bucket \
  s3-sample-app
```

## Deploy to Kubernetes

```bash
# Build and push image (adjust registry as needed)
docker build -t s3-sample-app .
docker tag s3-sample-app:latest your-registry/s3-sample-app:latest
docker push your-registry/s3-sample-app:latest

# Deploy to cluster
kubectl apply -f k8s-deployment.yaml
```

## Environment Variables

- `PORT` - App port (default: 3000)
- `S3_ENDPOINT` - S3 endpoint URL (default: http://s3.local)
- `S3_BUCKET` - S3 bucket name (default: s3-mirror)
- `AWS_ACCESS_KEY_ID` - Dummy key (proxy handles real auth)
- `AWS_SECRET_ACCESS_KEY` - Dummy secret (proxy handles real auth)

## How It Works

1. The app presents a simple HTML upload form
2. Files are uploaded to `/uploads/` prefix in the S3 bucket
3. The app uses the proxy endpoint as if it were S3
4. The proxy handles the actual S3 authentication and mirroring

## Notes

- Dummy credentials are fine - the proxy handles real authentication
- Files are prefixed with timestamp to avoid collisions

# Build stage
FROM --platform=$BUILDPLATFORM golang:1.21-alpine AS builder

# Accept build arguments for cross-compilation
ARG TARGETOS
ARG TARGETARCH

# Install build dependencies
RUN apk add --no-cache git ca-certificates

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY main.go ./

# Build the application for the target platform
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -a -installsuffix cgo -o s3-proxy .

# Final stage
FROM --platform=$TARGETPLATFORM alpine:3.18

# Install ca-certificates for HTTPS connections to S3 endpoints
RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copy binary from builder
COPY --from=builder /app/s3-proxy .

# Expose HTTP port
EXPOSE 8080

# Run the proxy
CMD ["./s3-proxy"]
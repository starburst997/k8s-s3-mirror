# Build stage
FROM golang:1.21-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates

WORKDIR /app

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY main.go ./
COPY cert-generator ./cert-generator/

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o s3-proxy .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o cert-gen ./cert-generator

# Final stage
FROM alpine:3.18

# Install ca-certificates for HTTPS
RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copy binaries from builder
COPY --from=builder /app/s3-proxy .
COPY --from=builder /app/cert-gen .

# Generate self-signed certificate at startup if not provided
RUN ./cert-gen

# Expose HTTPS port
EXPOSE 8443

# Run the proxy
CMD ["./s3-proxy"]
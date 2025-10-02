package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/lib/pq"
	log "github.com/sirupsen/logrus"
)

var (
	// Environment variables
	mainS3Endpoint     string
	mainAccessKey      string
	mainSecretKey      string
	mirrorS3Endpoint   string
	mirrorAccessKey    string
	mirrorSecretKey    string
	mirrorBucketPrefix string
	postgresURL        string
	disableDatabase    bool

	// Database connection pool
	db *sql.DB
	// Database connections cache per bucket
	dbConnections = make(map[string]*sql.DB)
	dbMutex       sync.RWMutex
)

func init() {
	// Configure logging
	log.SetFormatter(&log.JSONFormatter{})

	// Set log level from environment
	logLevel := getEnvOrDefault("LOG_LEVEL", "info")
	switch strings.ToLower(logLevel) {
	case "debug":
		log.SetLevel(log.DebugLevel)
	case "warn", "warning":
		log.SetLevel(log.WarnLevel)
	case "error":
		log.SetLevel(log.ErrorLevel)
	case "fatal":
		log.SetLevel(log.FatalLevel)
	case "off", "disabled", "none":
		log.SetLevel(log.PanicLevel) // Effectively disables logging except panics
	default:
		log.SetLevel(log.InfoLevel)
	}

	// Load environment variables
	mainS3Endpoint = getEnvOrDefault("MAIN_S3_ENDPOINT", "https://s3.amazonaws.com")
	mainAccessKey = getEnv("MAIN_ACCESS_KEY")
	mainSecretKey = getEnv("MAIN_SECRET_KEY")
	mirrorS3Endpoint = getEnv("MIRROR_S3_ENDPOINT")
	mirrorAccessKey = getEnv("MIRROR_ACCESS_KEY")
	mirrorSecretKey = getEnv("MIRROR_SECRET_KEY")
	mirrorBucketPrefix = getEnvOrDefault("MIRROR_BUCKET_PREFIX", "")

	// Check if database tracking should be disabled
	disableDatabase = getEnvOrDefault("DISABLE_DATABASE", "false") == "true"

	// Support both full POSTGRES_URL or separate components for easier sidecar config
	if !disableDatabase {
		postgresURL = getEnv("POSTGRES_URL")
		if postgresURL == "" {
			// Build URL from components if not provided
			host := getEnvOrDefault("POSTGRES_HOST", "localhost")
			port := getEnvOrDefault("POSTGRES_PORT", "5432")
			user := getEnvOrDefault("POSTGRES_USER", "s3mirror")
			password := getEnv("POSTGRES_PASSWORD")
			database := getEnvOrDefault("POSTGRES_DB", "s3_mirror")
			sslmode := getEnvOrDefault("POSTGRES_SSLMODE", "disable")

			if password != "" {
				postgresURL = fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
					user, password, host, port, database, sslmode)
			}
		}
	}

	// Validate required environment variables
	if mainAccessKey == "" || mainSecretKey == "" || mirrorS3Endpoint == "" || mirrorAccessKey == "" || mirrorSecretKey == "" {
		log.Fatal("Required environment variables not set: MAIN_ACCESS_KEY, MAIN_SECRET_KEY, MIRROR_S3_ENDPOINT, MIRROR_ACCESS_KEY, MIRROR_SECRET_KEY")
	}

	if !disableDatabase && postgresURL == "" {
		log.Fatal("POSTGRES_URL or POSTGRES_PASSWORD is required when database is enabled")
	}
}

func main() {
	// Initialize main database connection if enabled
	if !disableDatabase {
		var err error
		db, err = sql.Open("postgres", postgresURL)
		if err != nil {
			log.Fatalf("Failed to connect to database: %v", err)
		}
		defer db.Close()

		// Test database connection
		if err := db.Ping(); err != nil {
			log.Fatalf("Failed to ping database: %v", err)
		}
		log.Info("Database connection established")
	} else {
		log.Info("Database tracking disabled")
	}

	// Create main proxy
	targetURL, err := url.Parse(mainS3Endpoint)
	if err != nil {
		log.Fatalf("Failed to parse main S3 endpoint: %v", err)
	}

	// Create HTTP handler
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handleProxyRequest(w, r, targetURL)
	})

	// Simple HTTP server
	server := &http.Server{
		Addr:    ":8080",
		Handler: handler,
	}

	log.Info("Starting S3 proxy server on :8080...")
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func handleProxyRequest(w http.ResponseWriter, req *http.Request, targetURL *url.URL) {
	// Read the request body
	var bodyBytes []byte
	if req.Body != nil {
		bodyBytes, _ = io.ReadAll(req.Body)
		req.Body.Close()
	}

	// Extract bucket and key for logging (supports both path-style and virtual-hosted style)
	bucket, key := extractBucketAndKey(req.URL.Path, req.Host)

	// Create new request to forward to main S3
	forwardURL := *targetURL

	// Determine if this is virtual-hosted style and convert to path-style for forwarding
	// (Most S3-compatible services support path-style, and it's simpler for proxying)
	if bucket != "" && !strings.HasPrefix(req.URL.Path, "/"+bucket) {
		// This was virtual-hosted style, convert to path-style
		if key != "" {
			forwardURL.Path = "/" + bucket + "/" + key
		} else {
			forwardURL.Path = "/" + bucket
		}
	} else {
		// Already path-style, use as-is
		forwardURL.Path = req.URL.Path
	}
	forwardURL.RawQuery = req.URL.RawQuery

	forwardReq, err := http.NewRequest(req.Method, forwardURL.String(), bytes.NewReader(bodyBytes))
	if err != nil {
		http.Error(w, "Failed to create forward request", http.StatusInternalServerError)
		return
	}

	// Copy relevant headers
	for k, v := range req.Header {
		if strings.HasPrefix(k, "Content-") || strings.HasPrefix(k, "X-Amz-") {
			forwardReq.Header[k] = v
		}
	}

	// Sign the request with main S3 credentials
	signRequestV4(forwardReq, mainAccessKey, mainSecretKey, "us-east-1", "s3", bodyBytes)

	// Forward the request
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	resp, err := client.Do(forwardReq)
	if err != nil {
		http.Error(w, "Failed to forward request to S3", http.StatusBadGateway)
		log.Errorf("Failed to forward request: %v", err)
		return
	}
	defer resp.Body.Close()

	// Copy response headers
	for k, v := range resp.Header {
		w.Header()[k] = v
	}

	// Set status code
	w.WriteHeader(resp.StatusCode)

	// Copy response body
	respBody, _ := io.ReadAll(resp.Body)
	w.Write(respBody)

	// Handle background operations for successful requests
	if resp.StatusCode >= 200 && resp.StatusCode < 300 && bucket != "" && key != "" {
		// Only log successful operations at debug level to reduce log volume
		log.Debugf("S3 operation: %s %s/%s - Status: %d", req.Method, bucket, key, resp.StatusCode)

		go func() {
			switch req.Method {
			case "PUT", "POST":
				handlePutRequest(bucket, key, req, bodyBytes, resp)
			case "DELETE":
				handleDeleteRequest(bucket, key, req)
			}
		}()
	} else if resp.StatusCode >= 400 {
		// Only log errors
		log.Errorf("S3 operation failed: %s %s/%s - Status: %d", req.Method, bucket, key, resp.StatusCode)
	}
}

func handlePutRequest(bucket, key string, req *http.Request, body []byte, resp *http.Response) {
	// Skip database operations if disabled
	if disableDatabase {
		// Just mirror to backup S3
		if err := mirrorToBackupS3(bucket, key, req.Method, body, req.Header); err != nil {
			log.Errorf("Failed to mirror to backup S3: %v", err)
		}
		return
	}

	// Get or create database connection for bucket
	bucketDB := getOrCreateBucketDB(bucket)
	if bucketDB == nil {
		log.Errorf("Failed to get database for bucket %s", bucket)
		return
	}

	// Extract file info
	size := len(body)
	if contentLength := resp.Header.Get("Content-Length"); contentLength != "" {
		if cl, err := strconv.Atoi(contentLength); err == nil {
			size = cl
		}
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	// Get table name for this bucket
	tableName := sanitizeDBName(bucket)

	// Log to database
	_, err := bucketDB.Exec(fmt.Sprintf(`
		INSERT INTO %s (path, size, content_type, is_backed_up, last_modified, deleted)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (path)
		DO UPDATE SET
			size = $2,
			content_type = $3,
			is_backed_up = $4,
			last_modified = $5,
			deleted = $6
	`, tableName), key, size, contentType, false, time.Now(), false)

	if err != nil {
		log.Errorf("Failed to insert file record: %v", err)
		return
	}

	// Mirror to backup S3
	if err := mirrorToBackupS3(bucket, key, req.Method, body, req.Header); err != nil {
		log.Errorf("Failed to mirror to backup S3: %v", err)
	} else {
		// Mark as backed up
		_, err = bucketDB.Exec(fmt.Sprintf(`
			UPDATE %s SET is_backed_up = true WHERE path = $1
		`, tableName), key)
		if err != nil {
			log.Errorf("Failed to update backup status: %v", err)
		}
	}
}

func handleDeleteRequest(bucket, key string, req *http.Request) {
	// Skip database operations if disabled
	if disableDatabase {
		// Just mirror delete to backup S3
		if err := mirrorToBackupS3(bucket, key, "DELETE", nil, req.Header); err != nil {
			log.Errorf("Failed to mirror delete to backup S3: %v", err)
		}
		return
	}

	// Get database connection for bucket
	bucketDB := getOrCreateBucketDB(bucket)
	if bucketDB == nil {
		log.Errorf("Failed to get database for bucket %s", bucket)
		return
	}

	// Get table name for this bucket
	tableName := sanitizeDBName(bucket)

	// Mark as deleted in database
	_, err := bucketDB.Exec(fmt.Sprintf(`
		UPDATE %s SET deleted = true, last_modified = $1 WHERE path = $2
	`, tableName), time.Now(), key)

	if err != nil {
		log.Errorf("Failed to mark file as deleted: %v", err)
		return
	}

	// Mirror delete to backup S3
	if err := mirrorToBackupS3(bucket, key, "DELETE", nil, req.Header); err != nil {
		log.Errorf("Failed to mirror delete to backup S3: %v", err)
	}
}

func mirrorToBackupS3(bucket, key, method string, body []byte, headers http.Header) error {
	// Apply bucket prefix if configured
	mirrorBucket := bucket
	if mirrorBucketPrefix != "" {
		mirrorBucket = mirrorBucketPrefix + bucket
		log.Debugf("Mirroring to prefixed bucket: %s (original: %s)", mirrorBucket, bucket)
	}

	// Construct mirror URL
	mirrorURL, err := url.Parse(mirrorS3Endpoint)
	if err != nil {
		return err
	}
	mirrorURL.Path = fmt.Sprintf("/%s/%s", mirrorBucket, key)

	// Create new request for mirror
	req, err := http.NewRequest(method, mirrorURL.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}

	// Copy relevant headers
	for k, v := range headers {
		if strings.HasPrefix(k, "Content-") || strings.HasPrefix(k, "X-Amz-") {
			req.Header[k] = v
		}
	}

	// Sign request with mirror credentials
	signRequestV4(req, mirrorAccessKey, mirrorSecretKey, "us-east-1", "s3", body)

	// Send request
	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("mirror request failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	return nil
}

func signRequestV4(req *http.Request, accessKey, secretKey, region, service string, payload []byte) {
	// AWS Signature Version 4 signing
	now := time.Now().UTC()
	dateStamp := now.Format("20060102")
	amzDate := now.Format("20060102T150405Z")

	req.Header.Set("X-Amz-Date", amzDate)

	// Calculate payload hash
	payloadHash := sha256.Sum256(payload)
	payloadHashStr := hex.EncodeToString(payloadHash[:])
	req.Header.Set("X-Amz-Content-Sha256", payloadHashStr)

	// Create canonical request
	canonicalHeaders := createCanonicalHeaders(req)
	signedHeaders := createSignedHeaders(req)
	canonicalRequest := fmt.Sprintf("%s\n%s\n%s\n%s\n%s\n%s",
		req.Method,
		req.URL.Path,
		req.URL.RawQuery,
		canonicalHeaders,
		signedHeaders,
		payloadHashStr,
	)

	// Create string to sign
	algorithm := "AWS4-HMAC-SHA256"
	credentialScope := fmt.Sprintf("%s/%s/%s/aws4_request", dateStamp, region, service)
	canonicalRequestHash := sha256.Sum256([]byte(canonicalRequest))
	stringToSign := fmt.Sprintf("%s\n%s\n%s\n%s",
		algorithm,
		amzDate,
		credentialScope,
		hex.EncodeToString(canonicalRequestHash[:]),
	)

	// Calculate signature
	signingKey := getSigningKey(secretKey, dateStamp, region, service)
	signature := hmacSHA256(signingKey, []byte(stringToSign))

	// Add authorization header
	authorizationHeader := fmt.Sprintf("%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		algorithm,
		accessKey,
		credentialScope,
		signedHeaders,
		hex.EncodeToString(signature),
	)
	req.Header.Set("Authorization", authorizationHeader)
}

func createCanonicalHeaders(req *http.Request) string {
	var headers []string
	headerMap := make(map[string]string)

	for k, v := range req.Header {
		lowerKey := strings.ToLower(k)
		if lowerKey == "host" || strings.HasPrefix(lowerKey, "x-amz-") || lowerKey == "content-type" {
			headerMap[lowerKey] = strings.TrimSpace(v[0])
		}
	}

	// Add host header
	headerMap["host"] = req.Host
	if headerMap["host"] == "" {
		headerMap["host"] = req.URL.Host
	}

	var keys []string
	for k := range headerMap {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	for _, k := range keys {
		headers = append(headers, fmt.Sprintf("%s:%s", k, headerMap[k]))
	}

	return strings.Join(headers, "\n") + "\n"
}

func createSignedHeaders(req *http.Request) string {
	var headers []string
	for k := range req.Header {
		lowerKey := strings.ToLower(k)
		if lowerKey == "host" || strings.HasPrefix(lowerKey, "x-amz-") || lowerKey == "content-type" {
			headers = append(headers, lowerKey)
		}
	}
	headers = append(headers, "host")
	sort.Strings(headers)
	return strings.Join(headers, ";")
}

func getSigningKey(secretKey, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secretKey), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte(service))
	kSigning := hmacSHA256(kService, []byte("aws4_request"))
	return kSigning
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}

func extractBucketAndKey(urlPath, hostHeader string) (string, string) {
	// Check if this is virtual-hosted style (bucket.s3.amazonaws.com or bucket.s3-region.amazonaws.com)
	// Also support custom S3-compatible endpoints
	if hostHeader != "" {
		// Common patterns for virtual-hosted style:
		// - bucket.s3.amazonaws.com
		// - bucket.s3.region.amazonaws.com
		// - bucket.s3-region.amazonaws.com
		// - bucket.custom-s3-endpoint.com

		// For proxy use, we expect format: bucket.proxy-host:port or bucket.proxy-host
		parts := strings.Split(hostHeader, ".")
		if len(parts) >= 2 {
			// First part is likely the bucket name
			bucket := parts[0]
			// Remove port if present
			if colonIndex := strings.Index(bucket, ":"); colonIndex > 0 {
				bucket = bucket[:colonIndex]
			}

			// In virtual-hosted style, the path is just the object key
			key := strings.TrimPrefix(urlPath, "/")
			if bucket != "" && key != "" {
				return bucket, key
			}
			// If no key in path, might be a bucket operation
			if bucket != "" && urlPath == "/" {
				return bucket, ""
			}
		}
	}

	// Fall back to path-style parsing
	// Remove leading slash
	urlPath = strings.TrimPrefix(urlPath, "/")

	// Split into parts
	parts := strings.SplitN(urlPath, "/", 2)
	if len(parts) < 1 {
		return "", ""
	}
	if len(parts) == 1 {
		// Just bucket, no key
		return parts[0], ""
	}

	return parts[0], parts[1]
}

func getOrCreateBucketDB(bucket string) *sql.DB {
	if disableDatabase {
		return nil
	}

	// We use the main database connection for all buckets
	// Each bucket gets its own table
	tableName := sanitizeDBName(bucket)

	dbMutex.Lock()
	defer dbMutex.Unlock()

	// Check if we already verified this bucket's table
	if _, exists := dbConnections[bucket]; exists {
		return db
	}

	// Create table for this bucket if it doesn't exist
	createTableSQL := fmt.Sprintf(`
		CREATE TABLE IF NOT EXISTS %s (
			id SERIAL PRIMARY KEY,
			path TEXT UNIQUE NOT NULL,
			size BIGINT NOT NULL,
			content_type TEXT NOT NULL,
			is_backed_up BOOLEAN DEFAULT FALSE,
			last_modified TIMESTAMP NOT NULL,
			deleted BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT NOW(),
			updated_at TIMESTAMP DEFAULT NOW()
		)
	`, tableName)

	_, err := db.Exec(createTableSQL)
	if err != nil {
		log.Errorf("Failed to create table %s: %v", tableName, err)
		return nil
	}

	// Create indexes for performance
	indexCommands := []string{
		fmt.Sprintf("CREATE INDEX IF NOT EXISTS idx_%s_path ON %s(path)", tableName, tableName),
		fmt.Sprintf("CREATE INDEX IF NOT EXISTS idx_%s_backup ON %s(is_backed_up)", tableName, tableName),
		fmt.Sprintf("CREATE INDEX IF NOT EXISTS idx_%s_deleted ON %s(deleted)", tableName, tableName),
	}

	for _, cmd := range indexCommands {
		if _, err := db.Exec(cmd); err != nil {
			log.Warnf("Failed to create index: %v", err)
		}
	}

	// Mark that we've initialized this bucket's table
	dbConnections[bucket] = db

	log.Debugf("Created/verified table %s for bucket %s", tableName, bucket)
	return db
}

func sanitizeDBName(name string) string {
	// Replace non-alphanumeric characters with underscores and prefix with bucket_
	reg := regexp.MustCompile(`[^a-zA-Z0-9]+`)
	sanitized := reg.ReplaceAllString(name, "_")
	return "bucket_" + sanitized
}

func getEnv(key string) string {
	return os.Getenv(key)
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
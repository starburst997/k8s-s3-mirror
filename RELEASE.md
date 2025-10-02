# Release Process and CI/CD Configuration

## Versioning Strategy

This project follows [Semantic Versioning 2.0.0](https://semver.org/):

- **MAJOR** version (x.0.0): Incompatible API changes
- **MINOR** version (0.x.0): Backwards-compatible functionality additions
- **PATCH** version (0.0.x): Backwards-compatible bug fixes

### Version Tags

- Production releases: `v1.2.3`
- Pre-releases: `v1.2.3-rc.1`, `v1.2.3-beta.1`
- Development builds: Automatically tagged with branch name and commit SHA

## GitHub Secrets Configuration

To enable automated testing and releases, configure the following secrets in your GitHub repository settings:

### Required for Integration Tests

Go to **Settings → Secrets and variables → Actions** and add:

#### Main S3 Storage (Primary)

- `TEST_MAIN_S3_ENDPOINT`: Your main S3 endpoint
  - AWS S3: `https://s3.amazonaws.com`
  - MinIO: `http://your-minio:9000`
  - Other S3-compatible: Your endpoint URL
- `TEST_MAIN_ACCESS_KEY`: Access key for main S3
- `TEST_MAIN_SECRET_KEY`: Secret key for main S3

#### Mirror S3 Storage (Backup)

- `TEST_MIRROR_S3_ENDPOINT`: Your mirror S3 endpoint
  - Backblaze B2: `https://s3.us-west-000.backblazeb2.com`
  - Another AWS region: `https://s3.eu-west-1.amazonaws.com`
  - MinIO: `http://your-backup-minio:9000`
- `TEST_MIRROR_ACCESS_KEY`: Access key for mirror S3
- `TEST_MIRROR_SECRET_KEY`: Secret key for mirror S3

## Release Process

### Automated Releases (Recommended)

1. **Create a new release via GitHub UI**:

   - Go to **Releases → Draft a new release**
   - Create a new tag (e.g., `v1.2.3`)
   - GitHub Actions will automatically:
     - Run all tests
     - Build multi-platform binaries
     - Create Docker images
     - Package Helm chart
     - Generate changelog
     - Publish GitHub release with artifacts

2. **Manual release via workflow dispatch**:
   - Go to **Actions → Release workflow**
   - Click **Run workflow**
   - Enter version number (without `v` prefix)
   - Workflow will create tag and release

### Manual Release (Alternative)

```bash
# 1. Create and push a tag
git tag v1.2.3
git push origin v1.2.3

# 2. GitHub Actions will automatically create the release
```

## CI/CD Workflows

### 1. Build and Test (`build.yaml`)

**Triggers**:

- Push to `main` or `develop` branches
- Pull requests to `main`
- Manual workflow dispatch
- Git tags (`v*`)

**Actions**:

- Run Go unit tests
- Run integration tests with real S3 endpoints
- Build and push Docker images (on main/tags only)
- Multi-platform support (linux/amd64, linux/arm64)

### 2. Release (`release.yaml`)

**Triggers**:

- Push of semantic version tags (`v*.*.*`)
- Manual workflow dispatch with version input

**Actions**:

- Build Go binaries for multiple platforms:
  - Linux (amd64, arm64)
  - macOS (amd64, arm64)
  - Windows (amd64)
- Create Docker images with version tags
- Package Helm chart
- Generate changelog from commits
- Create GitHub release with all artifacts
- Update Helm chart repository

### 3. Helm Chart (`helm.yaml`)

**Triggers**:

- Changes to `helm/**` directory
- GitHub release published
- Manual workflow dispatch

**Actions**:

- Package Helm chart
- Publish to GitHub Pages (`gh-pages` branch)
- Available at: https://starburst997.github.io/k8s-s3-mirror/charts

## Development Workflow

### Feature Development

```bash
# 1. Create feature branch
git checkout -b feature/my-feature

# 2. Make changes and test locally
docker compose -f test/docker-compose.yml up --build
docker compose exec test-client node index.js test my-bucket

# 3. Commit and push
git add .
git commit -m "feat: add new feature"
git push origin feature/my-feature

# 4. Create pull request
# CI will run tests automatically
```

### Creating a Release

```bash
# 1. Ensure main branch is up to date
git checkout main
git pull

# 2. Create release tag
git tag v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3

# 3. GitHub Actions will handle the rest
```

## Consuming Releases

### Docker Images

```bash
# Latest stable
docker pull ghcr.io/starburst997/k8s-s3-mirror:latest

# Specific version
docker pull ghcr.io/starburst997/k8s-s3-mirror:v1.2.3

# Major version (auto-updates to latest minor/patch)
docker pull ghcr.io/starburst997/k8s-s3-mirror:v1
```

### Helm Chart

```bash
# Add repository
helm repo add k8s-s3-mirror https://starburst997.github.io/k8s-s3-mirror/charts
helm repo update

# Install specific version
helm install s3-mirror k8s-s3-mirror/s3-mirror --version 1.2.3

# Upgrade to latest
helm upgrade s3-mirror k8s-s3-mirror/s3-mirror
```

### Binary Downloads

Binaries are available from GitHub releases:

```bash
# Linux amd64
wget https://github.com/starburst997/k8s-s3-mirror/releases/download/v1.2.3/s3-proxy-linux-amd64.tar.gz

# macOS arm64 (Apple Silicon)
wget https://github.com/starburst997/k8s-s3-mirror/releases/download/v1.2.3/s3-proxy-darwin-arm64.tar.gz

# Windows
wget https://github.com/starburst997/k8s-s3-mirror/releases/download/v1.2.3/s3-proxy-windows-amd64.zip
```

## Best Practices

1. **Always test in a feature branch** before merging to main
2. **Use semantic commit messages** for better changelogs:

   - `feat:` New features
   - `fix:` Bug fixes
   - `docs:` Documentation changes
   - `chore:` Maintenance tasks
   - `refactor:` Code refactoring
   - `test:` Test additions/changes

3. **Version appropriately**:

   - Breaking changes → Major version bump
   - New features → Minor version bump
   - Bug fixes → Patch version bump

4. **Test with actual S3 services** before releasing:

   - Use free tiers for testing (AWS S3, Backblaze B2)
   - Test both main and mirror endpoints
   - Verify PostgreSQL tracking works correctly

5. **Document breaking changes** prominently in release notes

## Troubleshooting

### Tests Failing in CI

1. Check GitHub Secrets are properly configured
2. Verify S3 buckets exist and have proper permissions
3. Check test bucket name doesn't conflict (uses unique run ID)

### Release Workflow Issues

1. Ensure tag follows semantic versioning format (`v*.*.*`)
2. Check GitHub Actions permissions (needs write access)
3. Verify Helm chart version is valid

### Docker Build Failures

1. Check Go version compatibility (requires 1.21+)
2. Verify multi-platform build support
3. Check GitHub Container Registry permissions

## Support

For issues or questions:

- Open an [issue](https://github.com/starburst997/k8s-s3-mirror/issues)
- Check [GitHub Actions](https://github.com/starburst997/k8s-s3-mirror/actions) for CI/CD status
- Review [releases](https://github.com/starburst997/k8s-s3-mirror/releases) for changelog

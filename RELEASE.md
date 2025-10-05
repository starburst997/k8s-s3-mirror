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

### Automated Version Management

This project uses Git tags for version management with automatic versioning based on branch:

- **Main branch**: Creates stable releases (e.g., `v1.2.0`)
  - Automatically increments minor version from latest dev tag
  - Creates production-ready Docker images and Helm charts

- **Dev branch**: Creates development releases (e.g., `v1.2.3-dev`)
  - Automatically increments patch version
  - Creates development Docker images and Helm charts

### How Releases Work

1. **Production Release (main branch)**:
   ```bash
   # Simply push to main branch
   git checkout main
   git merge dev  # or your feature branch
   git push origin main
   # GitHub Actions automatically:
   # - Determines next version from dev tags
   # - Creates release tag (v1.2.0)
   # - Builds and publishes Docker image
   # - Packages and publishes Helm chart
   # - Creates GitHub release
   ```

2. **Development Release (dev branch)**:
   ```bash
   # Push to dev branch
   git checkout dev
   git merge feature/my-feature
   git push origin dev
   # GitHub Actions automatically:
   # - Increments patch version
   # - Creates dev tag (v1.2.3-dev)
   # - Builds and publishes dev Docker image
   # - Packages and publishes dev Helm chart
   ```

### No Manual Version Bumps

The Chart.yaml and application versions are set to `0.0.0` as placeholders. The CI/CD pipeline automatically replaces these with the correct version during the build process based on Git tags. This eliminates the need for version bump commits.

## CI/CD Workflows

### 1. Production Deploy (`prod-deploy.yaml`)

**Triggers**:

- Push to `main` branch

**Actions**:

- Automatically determine version from Git tags
- Create production version tag (e.g., `v1.2.0`)
- Build and push Docker images with version and `latest` tags
- Package and push Helm chart to OCI registry
- Create GitHub release with changelog
- Deploy to production environment

### 2. Development Deploy (`dev-deploy.yaml`)

**Triggers**:

- Push to `dev` branch

**Actions**:

- Automatically determine version from Git tags
- Create development version tag (e.g., `v1.2.3-dev`)
- Build and push Docker images with version and `dev` tags
- Package and push Helm chart to OCI registry
- Deploy to development environment

### 3. GitHub Pages (`gh-pages.yaml`)

**Triggers**:

- Push to `main` branch (for documentation changes)

**Actions**:

- Deploy documentation to GitHub Pages
- Available at project's GitHub Pages URL

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
docker pull ghcr.io/starburst997/s3-mirror:latest

# Specific version (both formats work)
docker pull ghcr.io/starburst997/s3-mirror:v1.2.3  # with v prefix
docker pull ghcr.io/starburst997/s3-mirror:1.2.3   # without v prefix

# Minor version (auto-updates to latest patch)
docker pull ghcr.io/starburst997/s3-mirror:1.2     # updates to 1.2.x

# Major version (auto-updates to latest minor/patch)
docker pull ghcr.io/starburst997/s3-mirror:1       # updates to 1.x.x
docker pull ghcr.io/starburst997/s3-mirror:v1      # with v prefix also works
```

### Helm Chart

```bash
# Install from GitHub Container Registry (OCI)
# Latest version
helm install s3-mirror oci://ghcr.io/starburst997/charts/s3-mirror

# Install specific version
helm install s3-mirror oci://ghcr.io/starburst997/charts/s3-mirror --version 1.2.3

# Upgrade to latest
helm upgrade s3-mirror oci://ghcr.io/starburst997/charts/s3-mirror
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

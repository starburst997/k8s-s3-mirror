# Contributing to K8S S3 Mirror

First off, thank you for considering contributing to K8S S3 Mirror! It's people like you that make this project better for everyone.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct: be respectful, inclusive, and constructive in all interactions.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When creating a bug report, include:

- A clear and descriptive title
- Steps to reproduce the issue
- Expected behavior vs actual behavior
- Your environment details (Kubernetes version, Go version, etc.)
- Any relevant logs or error messages

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- A clear and descriptive title
- A detailed description of the proposed functionality
- Why this enhancement would be useful
- Possible implementation approaches

### Pull Requests

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. Ensure the test suite passes (`go test ./...`)
4. Make sure your code follows Go best practices
5. Issue that pull request!

## Development Process

### Setting Up Your Development Environment

```bash
# Clone your fork
git clone https://github.com/your-username/k8s-s3-mirror
cd k8s-s3-mirror

# Add upstream remote
git remote add upstream https://github.com/starburst997/k8s-s3-mirror

# Install dependencies
go mod download

# Run tests
go test ./...
```

### Code Style

- Follow standard Go conventions
- Use `gofmt` to format your code
- Run `go vet` to catch common mistakes
- Consider running `golint` for additional style checks

### Testing

- Write unit tests for new functionality
- Ensure all tests pass before submitting PR
- Test your changes in a real Kubernetes environment if possible

### Commit Messages

- Use clear and meaningful commit messages
- Start with a verb in present tense ("Add", "Fix", "Update", etc.)
- Reference issues and pull requests when relevant

## Questions?

Feel free to open an issue with your question or reach out through GitHub Discussions.

Thank you for contributing!

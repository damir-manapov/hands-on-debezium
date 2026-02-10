#!/bin/sh
set -e

echo "=== Running gitleaks ==="
gitleaks detect --source . -v

echo "=== Checking outdated dependencies (via Renovate) ==="
./renovate-check.sh

echo "=== Checking vulnerabilities ==="
pnpm audit --audit-level=moderate

echo "=== Health checks passed ==="

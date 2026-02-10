#!/bin/sh
set -e

echo "=== Running format ==="
pnpm run format

echo "=== Running lint ==="
pnpm run lint

echo "=== Running typecheck ==="
pnpm run typecheck

echo "=== Running tests ==="
pnpm run test

echo "=== All checks passed ==="

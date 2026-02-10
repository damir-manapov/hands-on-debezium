#!/bin/sh
set -e

echo "=========================================="
echo "Running all checks"
echo "=========================================="

./check.sh
./health.sh

echo "=========================================="
echo "All checks completed successfully"
echo "=========================================="

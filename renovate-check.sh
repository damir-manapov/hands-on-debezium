#!/bin/sh
set -e

# Node.js 24+ "happy eyeballs" IPv6 bug workaround
PRELOAD_SCRIPT=$(mktemp)
echo "require('net').setDefaultAutoSelectFamily(false);" > "$PRELOAD_SCRIPT"
trap "rm -f $PRELOAD_SCRIPT" EXIT
export NODE_OPTIONS="${NODE_OPTIONS:-} --require=$PRELOAD_SCRIPT --dns-result-order=ipv4first"

echo "=== Running Renovate dependency check ==="

OUTPUT=$(LOG_FORMAT=json LOG_LEVEL=debug npx -y renovate --platform=local --dry-run 2>&1 || true)

# Check for network errors
if echo "$OUTPUT" | grep -q '"result":"external-host-error"'; then
  echo "⚠ Renovate couldn't reach external hosts (network issue)"
  exit 2
fi

# Extract updates from JSON output
UPDATES=$(echo "$OUTPUT" | grep -o '"updates":\[[^]]*\]' | head -1 || true)

if [ -z "$UPDATES" ] || [ "$UPDATES" = '"updates":[]' ]; then
  echo "All dependencies are up to date"
  exit 0
fi

echo "Outdated dependencies found:"
echo "$OUTPUT" | grep -E '"depName"|"currentVersion"|"newVersion"|"datasource"' | head -40
exit 1

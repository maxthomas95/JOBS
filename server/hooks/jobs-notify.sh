#!/usr/bin/env bash
# Keep shell callers compatible while using the same metadata allowlist everywhere.
node "$(dirname "$0")/jobs-notify.js" >/dev/null 2>&1
exit 0

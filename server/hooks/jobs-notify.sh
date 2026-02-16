#!/usr/bin/env bash
# J.O.B.S. hook notify script — reads Claude Code hook JSON from stdin,
# POSTs to the JOBS server. Designed to be used as an async hook command.
# All errors are silently swallowed so Claude's work is never blocked.

JOBS_URL="${JOBS_URL:-http://localhost:8780}"

# Read JSON payload from stdin
INPUT=$(cat 2>/dev/null) || exit 0

# POST to JOBS server, timeout 2s, fail silently
curl -s -X POST \
  "${JOBS_URL}/api/hooks" \
  -H "Content-Type: application/json" \
  -d "$INPUT" \
  --connect-timeout 2 \
  --max-time 5 \
  >/dev/null 2>&1

exit 0

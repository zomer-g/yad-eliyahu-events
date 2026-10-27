#!/usr/bin/env bash
# xhostd boot step: runs as the app user with the full env.
set -euo pipefail
exec node src/server.js

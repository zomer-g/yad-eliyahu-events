#!/usr/bin/env bash
# xhostd build step: runs as root, without app env.
set -euo pipefail
npm ci --omit=dev --no-audit --no-fund

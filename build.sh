#!/bin/sh
# ai-review-poller: Bun compile helper — builds the single-file CLI binary.

set -eu

SCRIPT_DIR="$(cd "$(dirname -- "$0")" && pwd -P)"

REVIEW_LOOP_POLLER_SRC="${REVIEW_LOOP_POLLER_SRC:-$SCRIPT_DIR}"
REVIEW_LOOP_POLLER_STATE_DIR="${REVIEW_LOOP_POLLER_STATE_DIR:-/tmp/claude/review-loop-poller}"
REVIEW_LOOP_POLLER_BIN="${REVIEW_LOOP_POLLER_BIN:-$HOME/scripts/ai/skills/review-loop-poller}"
BUILD_QUIET="${BUILD_QUIET:-0}"

export REVIEW_LOOP_POLLER_SRC
export REVIEW_LOOP_POLLER_STATE_DIR
export REVIEW_LOOP_POLLER_BIN

mkdir -p "$REVIEW_LOOP_POLLER_STATE_DIR"

bin_dir=$(dirname -- "$REVIEW_LOOP_POLLER_BIN")
mkdir -p "$bin_dir"

if ! command -v bun >/dev/null 2>&1; then
  printf 'error: bun not found in PATH — install from https://bun.sh\n' >&2
  exit 2
fi

cd "$REVIEW_LOOP_POLLER_SRC"

if [ ! -d node_modules ]; then
  bun install >/dev/null
fi

bun build --compile --minify src/cli.ts --outfile "$REVIEW_LOOP_POLLER_BIN" >/dev/null

chmod +x "$REVIEW_LOOP_POLLER_BIN"

if [ "$BUILD_QUIET" != "1" ]; then
  printf 'built %s\n' "$REVIEW_LOOP_POLLER_BIN"
fi

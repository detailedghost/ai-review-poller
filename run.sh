#!/bin/sh
# ai-review-poller: POSIX bootstrap wrapper — self-heals missing binary, then execs it.

set -eu

SCRIPT_DIR="$(cd "$(dirname -- "$0")" && pwd -P)"

REVIEW_LOOP_POLLER_SRC="${REVIEW_LOOP_POLLER_SRC:-$SCRIPT_DIR}"
REVIEW_LOOP_POLLER_STATE_DIR="${REVIEW_LOOP_POLLER_STATE_DIR:-/tmp/claude/review-loop-poller}"
REVIEW_LOOP_POLLER_BIN="${REVIEW_LOOP_POLLER_BIN:-$HOME/.local/bin/ai-review-poller}"

export REVIEW_LOOP_POLLER_SRC
export REVIEW_LOOP_POLLER_STATE_DIR
export REVIEW_LOOP_POLLER_BIN

mkdir -p "$REVIEW_LOOP_POLLER_STATE_DIR"
chmod 700 "$REVIEW_LOOP_POLLER_STATE_DIR"

bin_dir=$(dirname -- "$REVIEW_LOOP_POLLER_BIN")
mkdir -p "$bin_dir"

need_rebuild=0
if [ ! -x "$REVIEW_LOOP_POLLER_BIN" ]; then
  need_rebuild=1
fi

if [ "$need_rebuild" -eq 1 ]; then
  if ! command -v bun >/dev/null 2>&1; then
    printf 'error: bun not found in PATH — install from https://bun.sh\n' >&2
    exit 2
  fi
  if ! command -v git >/dev/null 2>&1; then
    printf 'error: git not found in PATH — install git and retry\n' >&2
    exit 2
  fi

  if ! "$REVIEW_LOOP_POLLER_SRC/build.sh"; then
    printf 'error: build.sh failed; cannot self-heal binary at %s\n' \
      "$REVIEW_LOOP_POLLER_BIN" >&2
    exit 2
  fi

  ts=$(date -u +%FT%TZ)
  log_file="${REVIEW_LOOP_POLLER_STATE_DIR}/log"
  printf '{"ts":"%s","level":"warn","message":"🔁 binary missing; rebuilt from source","details":{"src":"%s","bin":"%s"}}\n' \
    "$ts" "$REVIEW_LOOP_POLLER_SRC" "$REVIEW_LOOP_POLLER_BIN" \
    >>"$log_file"
fi

exec "$REVIEW_LOOP_POLLER_BIN" "$@"

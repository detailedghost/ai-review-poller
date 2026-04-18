#!/bin/sh
# ai-review-poller: one-shot installer for Linux / macOS users.
#
# Clones (or updates) the repo into $AI_REVIEW_POLLER_HOME
# (default: $HOME/code/ai-review-poller), installs bun if missing,
# compiles the binary, and runs `run.sh --install` to register the cron
# entry and symlink the /review-loop skill into $HOME/.claude/skills.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/detailedghost/ai-review-poller/master/install.sh | sh
#   or
#   AI_REVIEW_POLLER_HOME=$HOME/src/ai-review-poller sh install.sh

set -eu

REPO_URL="${AI_REVIEW_POLLER_REPO:-https://github.com/detailedghost/ai-review-poller.git}"
INSTALL_DIR="${AI_REVIEW_POLLER_HOME:-$HOME/code/ai-review-poller}"
BRANCH="${AI_REVIEW_POLLER_BRANCH:-master}"

info() { printf 'ℹ️  %s\n' "$*"; }
warn() { printf '⚠️  %s\n' "$*" >&2; }
fail() {
  printf '❌ %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "required tool missing: $1"
}

detect_os() {
  uname_s=$(uname -s)
  case "$uname_s" in
  Linux) echo linux ;;
  Darwin) echo darwin ;;
  *) echo "$uname_s" ;;
  esac
}

install_bun_if_missing() {
  if command -v bun >/dev/null 2>&1; then
    info "bun already installed: $(bun --version)"
    return 0
  fi
  info "bun not found — installing via official script"
  if ! command -v curl >/dev/null 2>&1; then
    fail "curl required to bootstrap bun"
  fi
  curl -fsSL https://bun.sh/install | sh
  # bun install script drops bun into ~/.bun/bin
  if [ -x "$HOME/.bun/bin/bun" ]; then
    PATH="$HOME/.bun/bin:$PATH"
    export PATH
    info "bun installed at $HOME/.bun/bin/bun"
    warn "add 'export PATH=\"\$HOME/.bun/bin:\$PATH\"' to your shell rc if it is not already there"
  else
    fail "bun install finished but 'bun' is still not on PATH"
  fi
}

clone_or_update() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "updating existing checkout at $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
    git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
    git -C "$INSTALL_DIR" pull --quiet --ff-only origin "$BRANCH"
  elif [ -d "$INSTALL_DIR" ]; then
    fail "$INSTALL_DIR already exists but is not a git repo; move it aside and retry"
  else
    info "cloning $REPO_URL -> $INSTALL_DIR"
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --quiet --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

main() {
  os=$(detect_os)
  info "ai-review-poller installer ($os)"

  need git
  need uname

  install_bun_if_missing
  clone_or_update

  cd "$INSTALL_DIR"
  info "installing bun dependencies"
  bun install --silent

  info "compiling binary via build.sh"
  ./build.sh

  info "running run.sh --install (writes cron entry + symlinks the skill)"
  ./run.sh --install

  info ""
  info "done."
  info "  source checkout = $INSTALL_DIR"
  info "  re-run any time with:  $INSTALL_DIR/run.sh --install"
  info "  check status with:     $INSTALL_DIR/run.sh --status"
}

main "$@"

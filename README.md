<!-- markdownlint-disable MD013 MD033 MD041 MD060 -->

# ai-review-poller

A single-pass bun-compiled CLI that polls a code-hosting provider for
pull-request reviews left by an automated reviewer (GitHub Copilot by
default) and writes a small JSON status file. The optional Claude Code
skill under `skill/` turns that file into a `/review-loop --where`
command and adds a statusline badge.

No daemon. One cron job runs a single-shot binary every five minutes.
The binary hits the provider once, updates a SQLite dedup table, and
rewrites the status file.

## Requirements

- [bun](https://bun.sh) 1.1 or newer (only for building; the compiled
  binary has no runtime dependency on bun).
- A provider CLI that can yield a token. The GitHub provider uses
  `gh auth token`, so [GitHub CLI](https://cli.github.com) authenticated
  via `gh auth login`.
- `crontab` from any POSIX cron daemon (cronie, vixie-cron, systemd-cron).
- [Claude Code](https://claude.com/claude-code) if you want the
  `/review-loop` skill (optional).

## Install

**One-liner** (Linux and macOS):

```sh
curl -fsSL https://raw.githubusercontent.com/detailedghost/ai-review-poller/master/install.sh | sh
```

The installer bootstraps bun if needed, clones this repo (defaults to
`$HOME/code/ai-review-poller`; override with
`AI_REVIEW_POLLER_HOME=...`), compiles the binary, installs the cron
entry, and symlinks the `/review-loop` skill into `$HOME/.claude/skills`.

**Manual install** from any clone location:

```sh
git clone https://github.com/detailedghost/ai-review-poller.git
cd ai-review-poller
./run.sh --install
```

`run.sh` derives its own source path from the script location, so the
clone can live anywhere on disk.

## Commands

All commands go through `run.sh`, which ensures the binary is built
before delegating.

Command | Description
--- | ---
`./run.sh` | Single poll pass. This is what cron calls.
`./run.sh --install` | prereq check, build, cron install, symlink.
`./run.sh --uninstall` | Remove cron entry and state dir. Keeps binary.
`./run.sh --purge` | `--uninstall` plus delete the compiled binary.
`./run.sh --status` | Print paths, cron presence, last poll, count.
`./run.sh --where` | Print pending reviews and exit.
`./run.sh --help` | Usage summary.

## Environment Variables

All variables are optional. Defaults target `$HOME`-relative paths.

Variable | Default | Purpose
--- | --- | ---
`REVIEW_LOOP_POLLER_SRC` | `$HOME/code/ai-review-poller` | Source tree
`REVIEW_LOOP_POLLER_BIN` | `$HOME/scripts/ai/skills/review-loop-poller` | Binary
`REVIEW_LOOP_POLLER_STATE_DIR` | `/tmp/claude/review-loop-poller` | State
`REVIEW_LOOP_POLLER_CADENCE` | `*/5 * * * *` | Schedule
`REVIEW_LOOP_POLLER_STALE_MIN` | `60` | Minutes
`REVIEW_LOOP_POLLER_PROVIDER` | `github` | Registry key
`BUILD_QUIET` | unset | Silence build

## How It Works

1. cron calls `run.sh` every five minutes.
1. `run.sh` ensures the state directory exists and the binary is
   executable; if the binary goes missing, it rebuilds from source.
1. The binary resolves the configured provider, obtains a token from
   the provider's CLI, hits the provider once, and dedups new reviews
   against a local SQLite table.
1. A fresh `pending.json` file lands atomically. The `updatedAt`
   timestamp doubles as a heartbeat: stale means the poller stopped.

## Claude Code Integration

- The `skill/` directory ships a ready-to-use `/review-loop` skill.
- `--install` creates a symlink at `$HOME/.claude/skills/review-loop`
  pointing into this repo, so edits to the skill live alongside code.
- `/review-loop --where` reads `pending.json` directly and prints the
  pending list. It appends a stale warning if the last poll is older
  than `REVIEW_LOOP_POLLER_STALE_MIN` minutes.

## Uninstall

```sh
./run.sh --uninstall   # remove cron + state dir, keep binary
./run.sh --purge       # also delete the compiled binary
```

Both commands are idempotent. Running them on a system that never had
the poller installed exits cleanly with a no-op message.

## Security

- No tokens live in the repo. Tokens come from the provider's CLI at
  runtime and never land on disk or in logs. The logger redacts any
  `token`, `authorization`, or `Bearer ...` values.
- The SQLite file receives mode `0600`; the state directory `0700`.
- Every SQL statement uses a prepared statement with named parameters.
- Provider responses undergo validation before any DB insert (URL regex,
  finite-number check for IDs). Invalid entries drop with a log warning.
- The cron sentinel block assembles only from validated env values; path
  env overrides reject `..`, newlines, and carriage returns.

## Extending to Other Providers

To add GitLab, Bitbucket, Gitea, or another host: create
`src/providers/<name>.ts` exporting a `ReviewProvider` (see
`src/providers/types.ts`), register it in `src/providers/index.ts`, and
add tests. Users activate the new provider with
`REVIEW_LOOP_POLLER_PROVIDER=<name>` before `./run.sh --install`. See
`AGENTS.md` for the full recipe.

## Continuous Integration and Releases

`.github/workflows/ci.yml` runs on every pull request and every push to
`master`. It typechecks, runs biome, runs `bun test --coverage`,
compiles the binary, and uploads the binary and coverage as workflow
artifacts. A second job greps the tree for secret-shaped strings and
hard-coded home paths.

`.github/workflows/release-please.yml` runs on pushes to `master`. It
uses [release-please](https://github.com/googleapis/release-please) to
open (and eventually merge) a release pull request based on Conventional
Commit messages. When that release pull request lands, a GitHub release
goes out with a generated `CHANGELOG.md`, and the Linux x64 binary plus
a `sha256` checksum attach as release assets.

`.github/dependabot.yml` runs weekly (Monday 09:00 UTC) and opens
grouped PRs for npm/bun and GitHub Actions version bumps. Major-version
bumps get individual PRs so they receive deliberate review.

`.github/workflows/codeql.yml` runs CodeQL static analysis on every PR,
every push to `master`, and on a weekly schedule. It uses the
`security-and-quality` query suite against the TypeScript source and
surfaces findings in the GitHub Security tab.

Configure branch protection on `master` so the `build-lint-test` and
`secrets-scan` checks remain required before merge.

## License

MIT. See [LICENSE](LICENSE).

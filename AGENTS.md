<!-- markdownlint-disable MD013 MD033 MD041 MD060 -->

# AGENTS.md

Orientation for any agent (human or otherwise) landing in this repo.

## What this repo is

A single-pass CLI poller that asks a code-hosting provider which of your open pull requests have a review from an automated reviewer (GitHub Copilot by default), dedups against a local SQLite table, and rewrites a small JSON status file. A Claude Code skill under `skill/` reads that file to power `/review-loop --where` and a statusline badge. The binary is bun-compiled and designed to run once per cron tick — there is no resident daemon.

## Install as an end user

**Fastest** (one-liner, Linux and macOS):

```sh
curl -fsSL https://raw.githubusercontent.com/detailedghost/ai-review-poller/master/install.sh | sh
```

`install.sh` bootstraps bun if missing, clones the repo (defaults to
`$HOME/code/ai-review-poller`; override with `AI_REVIEW_POLLER_HOME=...`),
compiles the binary, calls `run.sh --install` to write the cron entry,
and symlinks the skill into `$HOME/.claude/skills/review-loop`.

**Manual** from any clone location:

```sh
git clone https://github.com/detailedghost/ai-review-poller.git
cd ai-review-poller
./run.sh --install
```

`run.sh` derives its own source directory from the script path, so the
checkout can live anywhere on disk.

Requirements: bun 1.1+, `gh` CLI authenticated, any POSIX cron daemon,
optional Claude Code for the skill.

## Install for development

```sh
git clone git@github.com:detailedghost/ai-review-poller.git
cd ai-review-poller
bun install
bun test
```

Run against an isolated scratch state dir so a dev run never collides with the installed cron:

```sh
REVIEW_LOOP_POLLER_STATE_DIR=/tmp/claude/ai-review-poller-dev ./run.sh
```

Typecheck: `bunx tsc --noEmit`. Format/lint: `bunx biome check src tests`.

## repo layout

| Path | Purpose |
|---|---|
| `src/config.ts` | env var defaults, validation, resolved `Config` object |
| `src/errors.ts` | Typed error hierarchy + the only logger; emoji level prefixes; token redaction |
| `src/poller.ts` | Single poll pass — resolve provider, fetch, dedup, write status |
| `src/cli.ts` | argv dispatch (install/uninstall/purge/status/where/help) |
| `src/commands/*.ts` | One file per subcommand |
| `src/lib/db.ts` | SQLite open + harden + prepared statements |
| `src/lib/pending.ts` | Atomic writer/reader for `pending.json` |
| `src/lib/crontab.ts` | Sentinel-block management |
| `src/lib/prereq.ts` | prereq-check logic (bun, gh, crontab, git) |
| `src/providers/types.ts` | `ReviewProvider`, `PullRequest`, `Review` interfaces |
| `src/providers/github.ts` | GitHub implementation (GraphQL + `gh auth token`) |
| `src/providers/index.ts` | Provider registry and `resolve()` |
| `skill/` | Canonical source of the `/review-loop` Claude Code skill |
| `tests/` | bun test suite |
| `run.sh`, `build.sh` | POSIX shell wrappers |
| `LICENSE`, `README.md`, `AGENTS.md` | Project docs |

## How to add a provider

1. Create `src/providers/<name>.ts` exporting a default `ReviewProvider` (see `src/providers/types.ts`).
2. Implement `getToken()` using the provider's CLI (shell out with `bun.Spawn`, argv array only). Throw `AuthError` with code `auth.token_cmd_failed` on failure.
3. Implement `fetchOpenPullRequests(token)` returning `PullRequest[]`. Validate the response; reject malformed entries with a `logWarn` call and continue.
4. Register in `src/providers/index.ts`: add the provider to the `registry` map keyed by its lowercase name.
5. Add tests at `tests/providers.<name>.test.ts` covering happy, edge (unexpected authors, zero PRs), and error (timeout, non-2xx) paths.
6. Users activate the new provider via `REVIEW_LOOP_POLLER_PROVIDER=<name> ./run.sh --install`. The cron sentinel block will include that env var.

The poller, SQLite schema, `pending.json` shape, statusline integration, and skill hooks are all provider-agnostic — no changes needed outside `src/providers/`.

## How to update the Claude Code skill

The `skill/` directory is the canonical source. End users run `./run.sh --install`, which symlinks `$HOME/.claude/skills/review-loop` into this directory. Edits here are picked up immediately — no copy step, no re-install.

- `skill/SKILL.md` — entry point (frontmatter + flag table + lazy-load pointers).
- `skill/references/workflow.md` — phase-by-phase contract (`IN:` / `OUT:` / gates).
- `skill/references/antagonist-prompt.md` — the launch recipe for the `copilot-antagonist` agent.

When adding a phase, keep the `IN:` / `OUT:` / gate shape. When adding a flag, update both the flag table in `SKILL.md` and the corresponding phase logic in `workflow.md`.

## Testing and linting

- Runner: `bun test` (`bun test --coverage` for line + branch metrics; 90%+ target).
- Strict TypeScript. No `any` in exported APIs; prefer `unknown` + narrowing.
- Format: biome, tabs, double-quoted strings, trailing commas.
- SQL: always use `db.query(...)` with named parameters. No string concatenation. A `tests/discipline.test.ts` greps the source tree to enforce this.
- Logging: only through `src/errors.ts`. No `console.*` calls elsewhere. A `tests/discipline.test.ts` greps the source tree to enforce this.
- Secrets: tokens never appear in logs. `tests/redaction.test.ts` feeds a canned token through every logger helper and asserts it never lands in the output.

## Release process

1. Land changes on a feature branch; open a pull request.
2. CI (when set up) runs `bun test --coverage` and biome.
3. Tag on `master`: `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z`.
4. No package is published — end users clone the repo.

Dependency updates arrive weekly via dependabot (`.github/dependabot.yml`),
grouped into one npm/bun PR and one GitHub Actions PR per week.
CodeQL static analysis (`.github/workflows/codeql.yml`) runs on every PR
and weekly; findings surface in the GitHub Security tab.

## Security checklist before merging

- No token, no api key, no personal credential anywhere in the tree. Secrets scan: `rg -E '(ghp_|github_pat_|AIza|AKIA|/home/[a-z0-9_-]+/)' --glob '!.git'`.
- No `console.*` outside `src/errors.ts`.
- No SQL string concatenation.
- New provider: all external responses validated before DB insert.
- File modes: SQLite file `0600`, state dir `0700`, `pending.json` `0600`.
- cron sentinel block assembled only from validated env (cadence regex, path rejection of `..`, `\n`, `\r`).

## Contact

Issues and questions: [https://github.com/detailedghost/ai-review-poller/issues](https://github.com/detailedghost/ai-review-poller/issues).

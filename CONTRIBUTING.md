<!-- markdownlint-disable MD013 MD033 MD041 MD060 -->

# Contributing

Thanks for wanting to help. This project actively welcomes AI-assisted
pull requests. If your patch comes from Claude Code, Codex, OpenCode,
Cursor, or another coding agent, just say so in the PR description — no
extra hoops.

## Ground rules

- Keep commits Conventional-Commit shaped so release-please can
  generate the changelog (`feat:`, `fix:`, `chore(deps):`, `docs:`,
  `ci:`, `test:`).
- Run `bun test`, `bunx tsc --noEmit`, and `bunx biome check src tests`
  before opening the PR. CI (`BLT`) runs the same checks.
- No secrets or personal paths in the tree. See
  [docs/security.md](docs/security.md) for the hardening contract.
- Keep lines of logic short and strongly typed — no `any`, no
  `console.*` outside `src/errors.ts`, no SQL string concatenation.

## Local setup

```sh
git clone https://github.com/detailedghost/ai-review-poller.git
cd ai-review-poller
bun install
bun test
```

Test binaries go to `dist/`; runtime state goes to
`/tmp/claude/review-loop-poller-test-*`. Both are in `.gitignore`.

## Adding features

- **New host provider** — see [docs/extending.md](docs/extending.md).
- **New skill harness target** — add it to `HARNESS_TARGETS` in
  `src/lib/symlink.ts` and create the matching `skills/<name>/` folder.
- **New error code** — add a row to the Error Catalog in
  [docs/security.md](docs/security.md) and a matching assertion in
  `tests/error-paths.test.ts`.

## AI-assisted pull request checklist

When an agent prepared the patch, please confirm in the PR body:

- [ ] The agent ran `bun test` locally (or you did) and all tests pass.
- [ ] The diff has no secrets, tokens, or hard-coded home paths.
- [ ] The commit messages follow Conventional Commits.
- [ ] Any new runtime behavior has a test covering the happy path and
  at least one error path.
- [ ] You read the diff end-to-end before approving it.

## Reporting issues

Open a GitHub issue at
[https://github.com/detailedghost/ai-review-poller/issues](https://github.com/detailedghost/ai-review-poller/issues).
If the issue involves a security concern, mark it private or email the
maintainer before opening a public ticket.

<!-- markdownlint-disable MD013 MD033 MD041 MD060 -->

# Extending ai-review-poller

## Add a new host provider

The poller is provider-agnostic at every layer except `src/providers/`.
To add GitLab, Bitbucket, Gitea, or any other code-hosting provider:

1. Create `src/providers/<name>.ts` exporting a default `ReviewProvider`
   (see `src/providers/types.ts` for the interface).
2. Implement `getToken()` using the provider's CLI (`glab auth token`,
   `bb-cli`, etc.). Shell out with `Bun.spawn` using an argv array —
   never string interpolation. Throw `AuthError` with
   `auth.token_cmd_failed` on failure.
3. Implement `fetchOpenPullRequests(token)` returning `PullRequest[]`.
   Validate the response shape before returning. Invalid entries drop
   with a `logWarn` call — they must not crash the poll pass.
4. Register the provider in `src/providers/index.ts`: add it to the
   `registry` map keyed by its lowercase name.
5. Add tests at `tests/providers.<name>.test.ts` covering happy path,
   edge cases (zero PRs, unexpected review authors), and error paths
   (timeout, non-2xx, malformed body). Mock `fetch` via
   `globalThis.fetch = (async () => ...) as unknown as typeof fetch`.
6. Users activate the new provider with
   `REVIEW_LOOP_POLLER_PROVIDER=<name>` before
   `ai-review-poller --install`. The scheduler sentinel block will
   include that environment variable automatically.

## Add a new skill harness target

The poller installs its Claude Code skill into three AI-coding
harnesses (Claude Code, Codex, OpenCode) by default. To add a new one:

1. Add a new entry to `HARNESS_TARGETS` in `src/lib/symlink.ts`:

   ```ts
   { name: "<harness>", symlink: `${HOME}/.<harness>/skills/review-loop`, sourceSubdir: "<harness>" }
   ```

2. Create `skills/<harness>/` and drop a harness-shaped skill file
   (`SKILL.md`, `prompt.md`, or whatever the harness consumes).
3. `ensureSkillSymlink` will pick it up automatically. Symlinks only
   get created when the harness's home directory already exists on the
   user's machine — missing harnesses get silently skipped.

## Add a new command

1. Add a handler in `src/commands/<name>.ts` exporting
   `cmd<Name>(config): Promise<void>`.
2. Wire it into `src/cli.ts` argv parsing.
3. Update the help output in `src/commands/help.ts`.
4. Add tests in `tests/<name>.test.ts`.
5. Update `README.md` "Commands" table.

## Add a new error code

1. Add a row to the Error Catalog in `docs/security.md`.
2. Throw the typed subclass from the relevant code path with the new
   stable `code` string (for example
   `throw new ApiError("api.rate_limited", "...")`).
3. Add a matching assertion in `tests/error-paths.test.ts` — every
   row in the catalog has exactly one test.

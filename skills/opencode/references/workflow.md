<!-- markdownlint-disable MD013 MD033 MD041 MD060 -->

# /review-loop Workflow

Each phase lists `IN:` (required state) and `OUT:` (produced state).
Gates are hard stops. The skill has no persistent state — round count
derives from the PR on each invocation.

## Phase 0 — Argument Parsing

IN: raw invocation string, environment.
OUT: `maxRounds` (int), `skip` (`bool`), `where` (`bool`),
`retrigger` (`bool`, default `true`), `auto` (`bool`, default `false`),
`waitTimeout` (int seconds, default `1800`).

- `--rounds N` → `maxRounds = N` (reject values < 1).
- `--skip` → `skip = true`.
- `--where` → `where = true`.
- `--no-retrigger` → `retrigger = false`. Disables the Phase 7
  Copilot re-request after `/address` completes — the round still
  runs, but the skill will not bounce another review. Equivalent to
  `--rounds <roundsDone+1>`, but explicit.
- `--auto` → `auto = true`. Engages Phase 8 (Auto Loop).
- `--wait-timeout <sec>` → `waitTimeout = <sec>` (reject values < 1).
- Reject `--auto` combined with `--no-retrigger`: print
  `review-loop: --auto and --no-retrigger are mutually exclusive` and
  exit 2.

`maxRounds` resolution when `--rounds` is omitted: read
`REVIEW_LOOP_MAX_ROUNDS` from the environment; when set to a positive
integer, use it. Otherwise default to `3`. Setting
`REVIEW_LOOP_MAX_ROUNDS=1` effectively disables auto-retrigger without
a flag on every invocation.

When `skip` equals `true`: print `review-loop: skipped` and exit 0.

## Phase 0.5 — Where Mode

IN: `where` flag.
OUT: printed list of pending Copilot reviews, exit 0. Runs before the
Phase 1 environment probe — no git or Copilot calls required.

When `where` equals `false`, skip this phase entirely.

1. Resolve the state file path:

   - Use `$REVIEW_LOOP_POLLER_STATE_DIR/pending.json` when the
     environment variable is set; otherwise default to
     `/tmp/claude/review-loop-poller/pending.json`.

1. When the file does not exist, print:

   ```text
   review-loop: no poller state yet — run $HOME/code/ai-review-poller/run.sh --install
   ```

   Exit 0.

1. Parse the file as JSON. On parse failure, print:

   ```text
   review-loop: pending.json is malformed; delete it or wait for the next poll
   ```

   Exit 1.

1. Compute staleness: `nowMs - Date.parse(pending.updatedAt)`.
   When staleness exceeds 60 min, print before the list:

   ```text
   warning: poller last ran <X> min ago — results may be stale.
   ```

1. Compute `pollerAge` as the human-readable relative time since
   `pending.updatedAt` (ISO-8601 relative, e.g. `3 min ago`).

1. When `pending.count == 0`, print:

   ```text
   review-loop: no PR reviews pending.
   ```

   Exit 0.

1. Otherwise print:

   ```text
   review-loop: <N> PRs with pending Copilot reviews (poller last ran <X> min ago)

     owner/repo-a #42  "Add OAuth device flow"
       https://github.com/owner/repo-a/pull/42
       review submitted 2026-04-18T14:02:11Z (6 min ago)

     owner/repo-b #7   "Fix migration ordering"
       https://github.com/owner/repo-b/pull/7
       review submitted 2026-04-18T13:58:44Z (10 min ago)

   Run `/review-loop` inside each repo's checkout to process.
   ```

   - Parse `owner/repo` and `#N` from `pr.url` using the `URL` constructor
     (no regex extraction).
   - `review submitted` timestamp comes from `pr.submittedAt`; relative age
     computed the same way as `pollerAge`.
   - One blank line between entries.

1. Exit 0.

GATE: only fires when `where == true`; always exits before Phase 1.

## Phase 1 — Environment Probe

IN: none.
OUT: `owner`, `repo`, `prNumber`, `prUrl`.

1. Run `address-helper.sh detect-github`. `github == false` → print
   `review-loop: not a GitHub remote; skipping.` and exit 0.
1. Run `gh pr view --json number,url,headRefName`. No open PR on
   this branch → print
   `review-loop: no open PR for this branch; open one first.`
   and exit 0.
1. Run `address-helper.sh check-copilot`. `available == false` →
   print `review-loop: Copilot reviewer unavailable here; skipping.`
   and exit 0. (`assumed-available` counts as available — real errors
   surface at Phase 3 trigger time.)

GATE: all three succeed.

## Phase 2 — Round Counter

IN: Phase 1 state.
OUT: `roundsDone` (int).

1. `address-helper.sh count-copilot-reviews` → integer.
1. When `roundsDone >= maxRounds` → print
   `review-loop: max rounds reached (N/N); stopping.` and exit 0.

GATE: `roundsDone < maxRounds`.

## Phase 3 — State Decision

IN: `roundsDone`.
OUT: next action: `trigger` | `act` | `wait`.

1. When `roundsDone == 0` → action `trigger`.
1. Otherwise run `address-helper.sh fetch-copilot-review`.
   - `submittedAt == null` → `wait`.
   - Let `latestReviewTs = submittedAt` and
     `lastCommitTs = git log -1 --format=%cI origin/<branch>` (fall
     back to local `HEAD` when the remote ref lags behind).
   - `latestReviewTs > lastCommitTs` → action `act`.
   - Otherwise → action `wait`.

Branches below execute based on this decision.

### 3a. Action `trigger`

1. `address-helper.sh request-copilot`. Internally this posts an
   `@copilot review` comment on the PR (not a `requested_reviewers`
   API call). The comment-based trigger works even on repositories
   where the Copilot GitHub App isn't wired up to accept review
   requests, and Copilot still posts a review authored by
   `copilot-pull-request-reviewer` — which is what the poller watches.

1. Print:

   ```text
   review-loop: Copilot review requested via @copilot comment (round 1 of <maxRounds>).
   Re-run /review-loop when the review is posted.
   ```

1. Check poller install state: resolve
   `$REVIEW_LOOP_POLLER_STATE_DIR/pending.json`
   (default `/tmp/claude/review-loop-poller/pending.json`) and check
   whether the sentinel block (`# BEGIN review-loop-poller`) appears
   in `crontab -l`. When the file or sentinel is absent, append to
   the exit message:

   ```text
   tip: install the Copilot review poller so you don't have to
   re-invoke manually → $HOME/code/ai-review-poller/run.sh --install
   ```

1. Exit 0.

### 3b. Action `wait`

1. Resolve the poller state file at
   `$REVIEW_LOOP_POLLER_STATE_DIR/pending.json`
   (default `/tmp/claude/review-loop-poller/pending.json`).

1. When the file exists and parses successfully:

   - Compute `pollerAge` = relative time since `pending.updatedAt`
     (e.g. `4 min ago`).

   - Print:

     ```text
     review-loop: awaiting Copilot re-review (round <roundsDone+1> of <maxRounds>).
     poller last ran <X> min ago; <N> PRs pending globally.
     Re-run /review-loop when it lands.
     ```

   - When `pending.updatedAt` exceeds 60 min old, append:

     ```text
     poller appears stale (last ran <X> min ago) — check cron or run run.sh --status
     ```

1. When the file does not exist or fails to parse, print:

   ```text
   review-loop: awaiting Copilot re-review (round <roundsDone+1> of <maxRounds>).
   Re-run /review-loop when it lands.
   ```

1. Exit 0.

### 3c. Action `act`

Proceed to Phase 4. The real work happens here.

GATE: one of trigger / wait / act fired.

## Phase 4 — Antagonist Filter (Act phase only)

IN: Phase 3 `fetch-copilot-review` JSON.
OUT: verdict file path `/tmp/claude/review-loop-<prNumber>.verdicts.json`.

1. Write the `.comments` array to
   `/tmp/claude/review-loop-<prNumber>.comments.json`.

1. Locate the spec file (best effort):

   - When branch name or any commit subject on this branch references
     `<NNN>_<name>` — look up
     `.agents/create-specs/<NNN>_<name>.md`. Skip when not found.
   - Otherwise skip spec context.

1. Launch the `copilot-antagonist` agent. Prompt:

   ```text
   Read references/antagonist-prompt.md for rules and output format.
   Comments JSON: /tmp/claude/review-loop-<prNumber>.comments.json
   Spec (optional): <path or "none">
   Return ONLY the verdict JSON array — no prose, no code fences.
   ```

1. Parse the returned JSON. Schema: array of
   `{commentId, threadId, verdict, reason}`.
   Every input comment must have exactly one matching entry with
   `verdict` in the allowed set. On failure, print the raw
   agent output and exit 1.

GATE: parsed verdict array matches the comment set.

## Phase 5 — Apply Rejections

IN: verdict array.
OUT: filtered verdict array (`accept` + `strange` only).

For each verdict:

- `reject-illogical` →
  `address-helper.sh resolve-with-reply <threadId> "#rejected-by-antagonist: <reason>"`
  (the helper adds the `[bot]` prefix automatically).
- `reject-other` → `address-helper.sh resolve-silent <threadId>`.
- `accept` / `strange` → keep in filtered array.

Write filtered array to
`/tmp/claude/review-loop-<prNumber>.verdicts.json`.

When the filtered array has no entries (Copilot posted comments but
every one got rejected): skip to Phase 7 with no `/address` call.

GATE: all rejects processed.

## Phase 6 — Hand Off to /address

IN: filtered verdict file path, `roundNumber = roundsDone + 1`.
OUT: `/address` exit status.

Invoke via the Skill tool:

```text
Skill(skill="address", args="--round <roundNumber> --verdicts /tmp/claude/review-loop-<prNumber>.verdicts.json")
```

`/address` handles:

- The verdict file as its work list (skip gather).
- Pausing on `strange` items via `AskUserQuestion` before fixing.
- Its normal fix → QA → commit+push → reply+resolve flow.

GATE: `/address` returns 0. Non-zero → surface the error and exit 1.
The round does **not** count as consumed (no Copilot re-trigger).

## Phase 7 — Re-trigger + Exit

IN: successful /address (or empty filtered array).
OUT: terminal.

1. When `retrigger == false`:

   - Print:

     ```text
     review-loop: round <N> complete. Auto-retrigger disabled (--no-retrigger).
     Re-run /review-loop manually to continue.
     ```

   - Skip the re-request and exit 0.

1. When `roundsDone + 1 < maxRounds`:

   - Capture `sinceIso = now()` (ISO-8601 UTC).

   - `address-helper.sh request-copilot`.

   - When `auto == true`: proceed to Phase 8 with `sinceIso` in hand.
     Do not exit.

   - Otherwise print:

     ```text
     review-loop: round <N> complete. Copilot re-review requested.
     Re-run /review-loop when it lands.
     ```

     and exit 0.

1. Otherwise (`roundsDone + 1 >= maxRounds`), print:

   ```text
   review-loop: final round (<N>/<maxRounds>) complete. Not re-requesting.
   ```

   and exit 0 regardless of `auto`.

GATE: printed summary, exited — unless auto-mode handed off to Phase 8.

## Phase 8 — Auto Loop

IN: `auto == true`, `waitTimeout`, `prUrl`, `sinceIso` from Phase 7's
`request-copilot` call, current `roundsDone`, `maxRounds`.
OUT: terminal after all rounds or first hard error.

Runs only when auto-mode is on. Replaces the normal Phase 7 exit with
a wait-then-continue loop.

1. Before the first round in an `--auto` invocation, verify the
   poller is installed: `pending.json` exists under
   `${REVIEW_LOOP_POLLER_STATE_DIR:-/tmp/claude/review-loop-poller}`
   AND `crontab -l` contains `# BEGIN review-loop-poller`. When either
   is missing, print:

   ```text
   review-loop: --auto requires the poller to be installed.
   Install it → $HOME/code/ai-review-poller/run.sh --install
   ```

   and exit 2 before firing any Copilot request.

1. After Phase 7's `request-copilot`, run:

   ```text
   address-helper.sh wait-for-copilot <prUrl> <sinceIso> --timeout=<waitTimeout>
   ```

   - exit 0 → a Copilot review with `submittedAt > sinceIso` has been
     observed in `pending.json`. Fall through to step 3.

   - exit 124 → timeout. Print:

     ```text
     review-loop: auto wait timed out after <M> min without a new
     Copilot review. Re-run /review-loop --auto to resume.
     ```

     and exit 0.

   - exit 2 → state file disappeared mid-run. Print the install tip
     from step 1 and exit 2.

1. Re-enter Phase 2 — read `count-copilot-reviews` into a fresh
   `roundsDone`. The existing Phase 2 gate (`roundsDone >= maxRounds`)
   fires the normal "max rounds reached" summary and exits when the
   cap is hit.

1. Continue through Phases 3–7 for the new round. When Phase 7
   re-enters auto-mode, go back to step 2 of this phase.

GATE: round cap hit, wait timeout, or hard error.

## Error Handling Summary

| Condition | Behavior |
| --- | --- |
| Not a GitHub remote | Exit 0 with message (skip) |
| No open PR | Exit 0 with message (skip) |
| Copilot unavailable | Exit 0 with message (skip) |
| Max rounds reached | Exit 0 with summary |
| Antagonist returned malformed JSON | Exit 1, print raw output |
| `/address` failed | Exit 1, no re-trigger — round not consumed |
| `request-copilot` posts a duplicate `@copilot review` comment | Treated as success (Copilot ignores repeat triggers without new commits) |
| `--where` with missing state file | Exit 0 with install tip |
| `--where` with malformed `pending.json` | Exit 1 with message |

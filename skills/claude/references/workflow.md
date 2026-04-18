<!-- markdownlint-disable MD013 MD033 MD041 MD060 -->

# /review-loop Workflow

Each phase lists `IN:` (required state) and `OUT:` (produced state).
Gates are hard stops. The skill has no persistent state — round count
derives from the PR on each invocation.

## Phase 0 — Argument Parsing

IN: raw invocation string.
OUT: `maxRounds` (int, default `3`), `skip` (`bool`), `where` (`bool`).

- `--rounds N` → `maxRounds = N` (reject values < 1).
- `--skip` → `skip = true`.
- `--where` → `where = true`.

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

1. `address-helper.sh request-copilot`.

1. Print:

   ```text
   review-loop: Copilot review requested (round 1 of <maxRounds>).
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

1. When `roundsDone + 1 < maxRounds`:

   - `address-helper.sh request-copilot`.

   - Print:

     ```text
     review-loop: round <N> complete. Copilot re-review requested.
     Re-run /review-loop when it lands.
     ```

1. Otherwise, print:

   ```text
   review-loop: final round (<N>/<maxRounds>) complete. Not re-requesting.
   ```

1. Exit 0.

GATE: printed summary, exited.

## Error Handling Summary

| Condition | Behavior |
| --- | --- |
| Not a GitHub remote | Exit 0 with message (skip) |
| No open PR | Exit 0 with message (skip) |
| Copilot unavailable | Exit 0 with message (skip) |
| Max rounds reached | Exit 0 with summary |
| Antagonist returned malformed JSON | Exit 1, print raw output |
| `/address` failed | Exit 1, no re-trigger — round not consumed |
| `request-copilot` returns already-pending | Treated as success |
| `--where` with missing state file | Exit 0 with install tip |
| `--where` with malformed `pending.json` | Exit 1 with message |

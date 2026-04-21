---
name: review-loop
description: >-
  Antagonistic GitHub Copilot review loop for an open PR. Requests
  Copilot review, filters its comments through a copilot-antagonist
  agent, hands accepted items to /address, and repeats — fire-and-forget,
  stateless, capped at 3 rounds by default.
user-invocable: true
---

<!-- markdownlint-disable MD003 MD013 MD022 MD033 MD041 MD060 -->

# /review-loop — Antagonistic Copilot Review Loop

Run this on the branch of an open PR. The skill is **stateless and
fire-and-forget**: each invocation does one step of the round. re-invoke
after Copilot posts a new review.

**Usage:** `/review-loop [--rounds N] [--auto] [--wait-timeout <sec>] [--no-retrigger] [--skip] [--where]`

| Flag | Effect |
|------|--------|
| `--rounds N` | Override the default 3-round cap. Also settable via `REVIEW_LOOP_MAX_ROUNDS`. |
| `--auto` | Run all rounds back-to-back in one invocation. Between rounds, the skill blocks on the poller's `pending.json` (no LLM tokens) until Copilot posts the next review, then continues. Requires the poller to be installed. |
| `--wait-timeout <sec>` | Cap for each between-round wait under `--auto`. Default `1800` (30 min). On timeout the skill exits cleanly so you can re-run `/review-loop --auto` later. |
| `--no-retrigger` | Run the round but skip the Copilot re-request at the end. Mutually exclusive with `--auto`. |
| `--skip` | No-op exit. Use when /create-spec auto-invokes this and you want to bail out. |
| `--where` | Print pending Copilot reviews from the poller's state file and exit. No git or Copilot calls. |

### Auto-retrigger

After `/address` completes a round, the skill automatically asks
Copilot for a new review (Phase 7) — you don't re-type anything. The
loop caps at `--rounds N` (default 3), so after the final round the
re-request is suppressed. Turn it off entirely with `--no-retrigger`
on a single invocation, or set `REVIEW_LOOP_MAX_ROUNDS=1` in your
shell to stop re-triggering by default.

### Auto mode

`--auto` drives every round in one invocation: request → wait (via the
poller's `pending.json`, no LLM calls) → antagonist → `/address` →
re-request → wait → …, up to `--rounds N`. The wait is a plain shell
`sleep` loop on the state file, so idle time between rounds costs
zero tokens. Without the poller installed, `--auto` exits 2 with an
install tip before firing any Copilot request.

### Auto-retrigger

After `/address` completes a round, the skill automatically asks
Copilot for a new review (Phase 7) — you don't re-type anything. The
loop caps at `--rounds N` (default 3), so after the final round the
re-request is suppressed. Turn it off entirely with `--no-retrigger`
on a single invocation, or set `REVIEW_LOOP_MAX_ROUNDS=1` in your
shell to stop re-triggering by default.

## Reference Files (lazy-load)

| File | When to read |
|------|-------------|
| [references/workflow.md](references/workflow.md) | Always — phase-by-phase IN/OUT and gates. |
| [references/antagonist-prompt.md](references/antagonist-prompt.md) | When launching the `copilot-antagonist` agent in the Act phase. |

## Helper

All `gh`/`git` operations go through `~/scripts/ai/skills/address-helper.sh`
(same helper `/address` uses). New subcommands used by this skill:
`detect-github`, `check-copilot`, `request-copilot`,
`fetch-copilot-review`, `count-copilot-reviews`, `resolve-silent`,
`resolve-with-reply`. Bot-prefix on replies is enforced inside the
helper — callers never construct `[bot] ...` themselves.

## General Rules

- **Never** modify tracked files directly. All edits happen inside `/address`.
- **Stateless.** Round number = current count of Copilot reviews on the PR.
- **Lazy.** On any non-actionable state (awaiting Copilot, max rounds
  reached, Copilot not available), print a one-line status and exit.
- **Token-efficient.** Hand the antagonist agent only the Copilot
  comments JSON path + (optionally) the spec path. Do not forward
  conversation context.

### No-findings close-out

When Copilot replies to an `@copilot review` with an issue comment
(authored by `copilot-swe-agent`) matching the poller's no-findings
pattern — e.g. "No additional code changes were needed" — the poller
records it in `pending.json` under a top-level `acks` array. The skill
reads that array in Phase 3 and exits cleanly with a close-out message,
skipping the antagonist / `/address` / re-trigger work. Override the
match pattern per host via `REVIEW_LOOP_POLLER_NO_FINDINGS_PATTERN`.

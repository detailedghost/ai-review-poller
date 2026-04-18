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

**Usage:** `/review-loop [--rounds N] [--skip] [--where]`

| Flag | Effect |
|------|--------|
| `--rounds N` | Override the default 3-round cap. |
| `--skip` | No-op exit. Use when /create-spec auto-invokes this and you want to bail out. |
| `--where` | Print pending Copilot reviews from the poller's state file and exit. No git or Copilot calls. |

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

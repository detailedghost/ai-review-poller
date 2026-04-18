<!-- markdownlint-disable MD013 MD033 MD041 MD060 -->

# /review-loop — Codex prompt

Codex does not yet ship a first-class skill system like Claude Code or
OpenCode. Install this prompt as a local instruction or per-project
`AGENTS.md` fragment so Codex picks up the same contract.

## Contract (identical to the Claude / OpenCode SKILL.md)

`/review-loop` runs one step per invocation against the currently
checked-out pull request:

1. Detect the git remote. If it is not GitHub, exit cleanly.
1. Request the GitHub Copilot reviewer if one has not been requested,
   or wait if the last review was already posted after the most recent
   commit.
1. Filter each Copilot comment through the `copilot-antagonist` agent
   (see `references/antagonist-prompt.md` in the source repository)
   and route accepted items to `/address`.
1. Cap at three rounds by default (`--rounds N` to override, or set
   `REVIEW_LOOP_MAX_ROUNDS` in the environment).
1. After `/address` completes a round, automatically re-request a
   Copilot review (Phase 7 of the workflow) until the round cap is
   hit. Pass `--no-retrigger` to run a single round without kicking
   off another review cycle.

## Companion commands

- `--where` — read `/tmp/claude/review-loop-poller/pending.json` and
  print the list of pending Copilot-reviewed PRs across all repos.
- `--skip` — bail out cleanly when a higher-level flow auto-triggered
  this skill and the user does not want to proceed.

## How to wire this into Codex

Codex looks for `AGENTS.md` files in the repository root and in
`~/.codex/AGENTS.md`. Copy the content of this prompt into either
location under a clearly delimited section, or link to this file via
the Codex memory tools.

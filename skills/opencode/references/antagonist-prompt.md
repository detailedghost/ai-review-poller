<!-- markdownlint-disable MD013 MD033 MD041 MD060 -->

# Launching the `copilot-antagonist` Agent

The full agent contract lives at `~/.claude/agents/copilot-antagonist.md`.
This file is the **launch recipe** — read it only when Phase 4 fires.

## Agent Launch

```text
Agent(
  subagent_type: "copilot-antagonist",
  description: "filter copilot comments",
  prompt: <see below>
)
```text

## Prompt Template

```text
You are running inside /review-loop Phase 4.

Comments JSON: /tmp/claude/review-loop-<PR>.comments.json
Spec file: <absolute path OR the literal string "none">

Read the Comments JSON. For each comment, read just the diff hunk and
the narrow window of its `path:line`. Do NOT explore beyond that.

If a spec path is provided (not "none"), read ONLY its "Contracts" and
"Testing Criteria" sections. Ignore the rest of the spec.

Emit a single JSON array — one entry per input comment — with fields
{commentId, threadId, verdict, reason} per the verdict rules in your
system prompt. No prose, no code fences, no preamble.
```text

## Verdict Reminder

- `accept` — hand to /address
- `reject-illogical` — reply with `reason`, then resolve
- `reject-other` — resolve silently
- `strange` — security-sensitive or spec-contradicting; user decides

## Validation After Return

- Must be valid JSON.
- Array length equals input comment count.
- Every input `commentId` appears exactly once.
- `verdict` ∈ {accept, reject-illogical, reject-other, strange}.
- `reason` non-empty when `verdict` is `reject-illogical` or `strange`.

Any failure: print the raw output to the user, exit 1, do not proceed
to Phase 5.

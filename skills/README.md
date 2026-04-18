<!-- markdownlint-disable MD013 MD033 MD041 MD060 -->

# /review-loop skill

Canonical source of the `/review-loop` Claude Code skill that ships with the `ai-review-poller` project.

End users do not clone or symlink anything by hand. The repo root's `run.sh --install` creates a symlink at `$HOME/.claude/skills/review-loop` pointing at this directory, so edits here are picked up immediately by Claude Code.

## Files

| File | Purpose |
|---|---|
| `SKILL.md` | Skill entry (frontmatter, flag table, lazy-load pointers) |
| `references/workflow.md` | Phase-by-phase contract with `IN:` / `OUT:` / gate shape |
| `references/antagonist-prompt.md` | Launch recipe for the `copilot-antagonist` agent |

See the repo-root `AGENTS.md` for how to update or extend the skill.

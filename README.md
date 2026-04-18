<!-- markdownlint-disable MD013 MD033 MD041 MD060 -->

# ai-review-poller

[![BLT](https://github.com/detailedghost/ai-review-poller/actions/workflows/blt.yml/badge.svg)](https://github.com/detailedghost/ai-review-poller/actions/workflows/blt.yml)
[![Release](https://github.com/detailedghost/ai-review-poller/actions/workflows/release.yml/badge.svg)](https://github.com/detailedghost/ai-review-poller/actions/workflows/release.yml)
[![CodeQL](https://github.com/detailedghost/ai-review-poller/actions/workflows/codeql.yml/badge.svg)](https://github.com/detailedghost/ai-review-poller/actions/workflows/codeql.yml)
[![Coverage](https://codecov.io/gh/detailedghost/ai-review-poller/branch/master/graph/badge.svg)](https://codecov.io/gh/detailedghost/ai-review-poller)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A bun-compiled CLI that polls a code-hosting provider for Copilot-style
pull-request reviews and rewrites a small JSON status file. Ships with
ready-to-use Claude Code, Codex, and OpenCode skills.

## Install

**Download the latest binary** (Linux x64):

```sh
mkdir -p "$HOME/.local/bin"
curl -fsSL -o "$HOME/.local/bin/ai-review-poller" \
  https://github.com/detailedghost/ai-review-poller/releases/latest/download/ai-review-poller-linux-x64
chmod +x "$HOME/.local/bin/ai-review-poller"
ai-review-poller --install
```

**Bootstrap one-liner** (clones the source, installs bun, builds the
binary, runs `--install`):

```sh
curl -fsSL https://raw.githubusercontent.com/detailedghost/ai-review-poller/master/install.sh | sh
```

## Run

```sh
ai-review-poller              # single poll pass (this is what the scheduler calls)
ai-review-poller --install    # prereq check, schedule install, symlink skills
ai-review-poller --uninstall  # remove scheduled entry and runtime state
ai-review-poller --purge      # uninstall + delete the compiled binary
ai-review-poller --status     # print paths, schedule presence, last poll
ai-review-poller --where      # print pending reviews and exit
ai-review-poller --help       # usage
```

See [docs/security.md](docs/security.md) for the token, file-mode,
and validation contract.

## Develop

```sh
git clone https://github.com/detailedghost/ai-review-poller.git
cd ai-review-poller
bun install
bun test
```

Run locally against a scratch state dir:

```sh
REVIEW_LOOP_POLLER_STATE_DIR=/tmp/claude/ai-review-poller-dev ./run.sh
```

Build the binary locally:

```sh
./build.sh   # writes $HOME/.local/bin/ai-review-poller by default
```

See [AGENTS.md](AGENTS.md) for an agent-oriented walkthrough, and
[docs/extending.md](docs/extending.md) for adding new providers, new
skill harnesses, new commands, or new error codes.

## Contribute

AI-assisted pull requests are welcome. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).

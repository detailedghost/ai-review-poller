import { logInfo } from "../errors.ts";

export async function cmdHelp(): Promise<void> {
	logInfo(`review-loop-poller — single-pass Copilot PR review poller

Usage:
  review-loop-poller [OPTIONS]

Options:
  --install              Prereq check, cron install, skill symlink, seed poll
  --uninstall            Remove cron entry + state dir (keeps binary)
  --purge                --uninstall + delete the compiled binary
  --status               Print paths, cron presence, last poll
  --where                Print pending Copilot reviews (reads pending.json)
  --provider <name>      Override provider (default: github)
  --help, -h             Show this help

Environment variables: see README.md or \`--status\`.`);
}

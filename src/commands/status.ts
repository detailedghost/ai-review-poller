import { existsSync } from "node:fs";
import type { Config } from "../config.ts";
import { logInfo, logWarn, StateError } from "../errors.ts";
import { hasBlock, readCrontab } from "../lib/crontab.ts";
import { readPending } from "../lib/pending.ts";
import { skillSymlinkStatus } from "../lib/symlink.ts";

function minutesAgo(iso: string, now: Date): number {
	return Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
}

export async function cmdStatus(config: Config): Promise<void> {
	const now = new Date();

	// Cron presence
	const crontab = await readCrontab();
	const installed = hasBlock(crontab);

	// Skill symlink
	const symlinkStatus = skillSymlinkStatus(config);

	// Binary existence
	const binExists = existsSync(config.binPath);

	// Pending state
	let lastPoll = "never";
	let pendingCount = 0;
	let stale = false;

	try {
		const pending = await readPending(config);
		if (pending !== null) {
			const ago = minutesAgo(pending.updatedAt, now);
			stale = ago > config.staleMinutes;
			lastPoll = `${pending.updatedAt}  (${ago} min ago)  [${stale ? "stale" : "fresh"}]`;
			pendingCount = pending.count;
		}
	} catch (err) {
		if (err instanceof StateError && err.code === "state.malformed_pending") {
			logWarn("pending.json is malformed — skipping last-poll display");
		} else {
			throw err;
		}
	}

	logInfo(
		[
			"review-loop-poller — status",
			"",
			`  installed: ${installed ? "yes" : "no"}`,
			`  provider: ${config.providerName}`,
			`  src: ${config.srcDir || "(unset — set REVIEW_LOOP_POLLER_SRC or run via run.sh)"}`,
			`  bin: ${config.binPath}  (${binExists ? "exists" : "missing"})`,
			`  state: ${config.stateDir}`,
			`  skill symlink: ${symlinkStatus}`,
			"",
			`  last poll: ${lastPoll}`,
			`  pending: ${pendingCount}`,
		].join("\n"),
	);
}

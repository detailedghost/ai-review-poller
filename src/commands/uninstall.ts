import { rmSync } from "node:fs";
import type { Config } from "../config.ts";
import { logInfo } from "../errors.ts";
import { hasBlock, readCrontab, removeBlock, writeCrontab } from "../lib/crontab.ts";
import { removeSkillSymlink } from "../lib/symlink.ts";

export async function cmdUninstall(config: Config): Promise<void> {
	// Remove crontab sentinel block
	const current = await readCrontab();
	if (hasBlock(current)) {
		const stripped = removeBlock(current);
		await writeCrontab(stripped.length > 0 ? `${stripped}\n` : "");
		logInfo("removed cron entry");
	} else {
		logInfo("no cron entry present — nothing to remove");
	}

	// Remove skill symlink (idempotent)
	const { removed } = removeSkillSymlink(config);
	if (removed) {
		logInfo("removed skill symlink ~/.claude/skills/review-loop");
	}

	// Safety check: only remove if the path matches the resolved stateDir
	const resolvedStateDir = config.stateDir;
	if (resolvedStateDir && resolvedStateDir.length > 1) {
		rmSync(resolvedStateDir, { recursive: true, force: true });
		logInfo(`removed state dir ${resolvedStateDir}`);
	}

	logInfo("uninstalled ✓");
}

import { existsSync } from "node:fs";
import { type Config, requireSrcDir } from "../config.ts";
import { logInfo, PrereqError } from "../errors.ts";
import { buildBlock, hasBlock, readCrontab, removeBlock, writeCrontab } from "../lib/crontab.ts";
import { assertPrereqs, checkPrereqs, printPrereqTable } from "../lib/prereq.ts";
import { ensureSkillSymlink } from "../lib/symlink.ts";
import { runPoll } from "../poller.ts";

export async function cmdInstall(config: Config, opts: { providerOverride?: string } = {}): Promise<void> {
	// 1. Prereq check
	const result = await checkPrereqs(new Set(["bun", "gh", "crontab", "git"]));
	printPrereqTable(result, config);
	assertPrereqs(result);

	// 2. Ensure binary exists — build if missing
	if (!existsSync(config.binPath)) {
		logInfo(`binary not found at ${config.binPath} — building from source`);
		const buildProc = Bun.spawn({
			cmd: [`${requireSrcDir(config)}/build.sh`],
			stdout: "pipe",
			stderr: "pipe",
		});
		const buildExit = await buildProc.exited;
		if (buildExit !== 0) {
			const stderr = await new Response(buildProc.stderr).text();
			throw new PrereqError("prereq.build_failed", `build.sh failed with exit ${buildExit}: ${stderr.trim()}`, {
				details: { exitCode: buildExit, stderr: stderr.slice(0, 500) },
			});
		}
		logInfo(`binary built at ${config.binPath}`);
	}

	// 3. Install crontab sentinel block
	const current = await readCrontab();
	const stripped = removeBlock(current);
	const block = buildBlock(config);
	const newCrontab = stripped.length > 0 ? `${stripped}\n${block}\n` : `${block}\n`;
	await writeCrontab(newCrontab);

	const verb = hasBlock(current) ? "replaced" : "added";
	logInfo(`cron entry ${verb}`);

	// 4. Skill symlink
	const symlinkResult = ensureSkillSymlink(config);
	if (symlinkResult.action === "created") {
		logInfo(`skill symlink created: ~/.claude/skills/review-loop -> ${requireSrcDir(config)}/skill`);
	} else {
		logInfo("skill symlink already correct");
	}

	// 5. Seed poll
	logInfo("running initial poll to seed pending.json");
	await runPoll(config);

	// 6. Summary
	logInfo(
		[
			"installed ✓",
			`  src      = ${requireSrcDir(config)}`,
			`  binary   = ${config.binPath}`,
			`  state    = ${config.stateDir}`,
			`  cadence  = ${config.cadence}`,
			`  provider = ${opts.providerOverride ?? config.providerName}`,
		].join("\n"),
	);
}

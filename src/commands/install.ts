import { existsSync } from "node:fs";
import type { Config } from "../config.ts";
import { logInfo, logWarn, PrereqError } from "../errors.ts";
import { buildBlock, hasBlock, readCrontab, removeBlock, writeCrontab } from "../lib/crontab.ts";
import { assertPrereqs, checkPrereqs, printPrereqTable, type Tool } from "../lib/prereq.ts";
import { ensureSkillSymlink } from "../lib/symlink.ts";
import { runPoll } from "../poller.ts";

export async function cmdInstall(config: Config, opts: { providerOverride?: string } = {}): Promise<void> {
	// Binary-only install (release download) vs source-checkout install.
	const hasSource = Boolean(config.srcDir);

	// 1. Prereq check — only require bun + git when we need to build from source.
	const required = new Set<Tool>(["gh", "crontab"]);
	if (hasSource && !existsSync(config.binPath)) {
		required.add("bun");
		required.add("git");
	}
	const result = await checkPrereqs(required);
	printPrereqTable(result, config);
	assertPrereqs(result);

	// 2. Ensure binary exists — build if missing (source-checkout path only).
	if (!existsSync(config.binPath)) {
		if (!hasSource) {
			throw new PrereqError(
				"prereq.binary_missing",
				`compiled binary not found at ${config.binPath} and REVIEW_LOOP_POLLER_SRC is unset — either set it to a source checkout or download the binary from the Releases page`,
				{ details: { binPath: config.binPath } },
			);
		}
		logInfo(`binary not found at ${config.binPath} — building from source`);
		const buildProc = Bun.spawn({
			cmd: [`${config.srcDir}/build.sh`],
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

	// 4. Skill symlinks — only possible with a source checkout (skills/ lives there).
	if (hasSource) {
		const symlinkResult = ensureSkillSymlink(config);
		for (const summary of symlinkResult.summaries) {
			if (summary.action === "created") {
				logInfo(`skill symlink created (${summary.target.name}): ${summary.target.symlink}`);
			} else if (summary.action === "already_correct") {
				logInfo(`skill symlink already correct (${summary.target.name})`);
			} else {
				logInfo(`skill symlink skipped (${summary.target.name}): ${summary.reason}`);
			}
		}
	} else {
		logWarn(
			"skill symlinks skipped — REVIEW_LOOP_POLLER_SRC is unset. Clone the repo and re-run `run.sh --install` to symlink the skills.",
		);
	}

	// 5. Seed poll
	logInfo("running initial poll to seed pending.json");
	await runPoll(config);

	// 6. Summary
	logInfo(
		[
			"installed ✓",
			`  src      = ${config.srcDir || "(unset — binary-only install)"}`,
			`  binary   = ${config.binPath}`,
			`  state    = ${config.stateDir}`,
			`  cadence  = ${config.cadence}`,
			`  provider = ${opts.providerOverride ?? config.providerName}`,
		].join("\n"),
	);
}

import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { type Config, requireSrcDir } from "../config.ts";
import { StateError } from "../errors.ts";

const HOME = process.env.HOME ?? "/tmp";

/**
 * The three AI-coding harnesses we know about. Each gets its own skill
 * sub-directory in the repo's `skills/` tree and its own symlink target
 * under $HOME.
 */
export interface HarnessTarget {
	readonly name: "claude" | "codex" | "opencode";
	/** Absolute path of the symlink we manage. */
	readonly symlink: string;
	/** Relative to the repo's `skills/` directory. */
	readonly sourceSubdir: string;
}

export const HARNESS_TARGETS: readonly HarnessTarget[] = [
	{
		name: "claude",
		symlink: `${HOME}/.claude/skills/review-loop`,
		sourceSubdir: "claude",
	},
	{
		name: "opencode",
		symlink: `${HOME}/.opencode/skills/review-loop`,
		sourceSubdir: "opencode",
	},
	{
		name: "codex",
		symlink: `${HOME}/.codex/skills/review-loop`,
		sourceSubdir: "codex",
	},
];

export type SymlinkStatus = "absent" | "correct" | "mispointed" | "real_dir" | "harness_absent";

export interface HarnessSymlinkStatus {
	readonly target: HarnessTarget;
	readonly status: SymlinkStatus;
	readonly expectedTarget: string;
	readonly currentTarget?: string;
}

function expectedTargetFor(config: Config, target: HarnessTarget): string {
	return `${requireSrcDir(config)}/skills/${target.sourceSubdir}`;
}

/** Backwards-compatible alias: returns the status of the primary (Claude) symlink. */
export const SKILL_SYMLINK = HARNESS_TARGETS[0]?.symlink ?? `${HOME}/.claude/skills/review-loop`;

export function harnessSymlinkStatus(config: Config, target: HarnessTarget): HarnessSymlinkStatus {
	const parent = dirname(target.symlink);
	// Status is read-only and tolerant: if srcDir is unset we still want to
	// report whether a symlink exists and where it points.
	const expectedTarget = config.srcDir ? expectedTargetFor(config, target) : "";
	if (!existsSync(parent)) {
		return { target, status: "harness_absent", expectedTarget };
	}

	let stat: ReturnType<typeof lstatSync> | undefined;
	try {
		stat = lstatSync(target.symlink);
	} catch {
		return { target, status: "absent", expectedTarget };
	}

	if (!stat.isSymbolicLink()) {
		return { target, status: "real_dir", expectedTarget };
	}

	let currentTarget: string;
	try {
		currentTarget = readlinkSync(target.symlink);
	} catch {
		return { target, status: "mispointed", expectedTarget };
	}

	return {
		target,
		status: currentTarget === expectedTarget ? "correct" : "mispointed",
		expectedTarget,
		currentTarget,
	};
}

/** Back-compat single-host helper, preserved for tests and older callers. */
export function skillSymlinkStatus(config: Config): SymlinkStatus {
	const target = HARNESS_TARGETS[0];
	if (!target) return "absent";
	const result = harnessSymlinkStatus(config, target);
	return result.status === "harness_absent" ? "absent" : result.status;
}

export interface EnsureSkillResult {
	readonly summaries: ReadonlyArray<{
		readonly target: HarnessTarget;
		readonly action: "created" | "already_correct" | "skipped";
		readonly reason?: string;
	}>;
}

/**
 * Install the skill symlink for every harness whose home directory exists.
 * Harnesses with a missing home dir are silently skipped.
 */
export function ensureSkillSymlink(config: Config): EnsureSkillResult {
	const summaries = HARNESS_TARGETS.map((target) => {
		const status = harnessSymlinkStatus(config, target);

		if (status.status === "harness_absent") {
			return {
				target,
				action: "skipped" as const,
				reason: `${dirname(target.symlink)} does not exist`,
			};
		}

		if (status.status === "correct") {
			return { target, action: "already_correct" as const };
		}

		if (status.status === "real_dir") {
			throw new StateError(
				"install.skill_dir_exists",
				`${target.symlink} already exists as a directory; back it up and remove it, then re-run --install.`,
				{ exitCode: 2, details: { path: target.symlink } },
			);
		}

		if (status.status === "mispointed") {
			throw new StateError(
				"install.skill_symlink_wrong",
				`${target.symlink} is a symlink pointing to ${status.currentTarget} — expected ${status.expectedTarget}`,
				{
					exitCode: 2,
					details: {
						current: status.currentTarget,
						expected: status.expectedTarget,
					},
				},
			);
		}

		mkdirSync(dirname(target.symlink), { recursive: true });
		symlinkSync(status.expectedTarget, target.symlink);
		return { target, action: "created" as const };
	});

	return { summaries };
}

export interface RemoveSkillResult {
	readonly removed: ReadonlyArray<HarnessTarget>;
}

export function removeSkillSymlink(config: Config): RemoveSkillResult {
	const removed: HarnessTarget[] = [];
	for (const target of HARNESS_TARGETS) {
		const status = harnessSymlinkStatus(config, target);
		if (status.status === "correct") {
			try {
				unlinkSync(target.symlink);
				removed.push(target);
			} catch {
				// best effort — don't block uninstall on a single flaky symlink
			}
		}
	}
	return { removed };
}

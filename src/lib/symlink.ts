import { lstatSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { type Config, requireSrcDir } from "../config.ts";
import { StateError } from "../errors.ts";

const HOME = process.env.HOME ?? "/tmp";
export const SKILL_SYMLINK = `${HOME}/.claude/skills/review-loop`;

export type SymlinkStatus = "absent" | "correct" | "mispointed" | "real_dir";

export function skillSymlinkStatus(config: Config): SymlinkStatus {
	let stat: ReturnType<typeof lstatSync> | undefined;
	try {
		stat = lstatSync(SKILL_SYMLINK);
	} catch {
		return "absent";
	}

	if (!stat.isSymbolicLink()) {
		return "real_dir";
	}

	let target: string;
	try {
		target = readlinkSync(SKILL_SYMLINK);
	} catch {
		return "mispointed";
	}

	const expectedTarget = `${requireSrcDir(config)}/skill`;
	return target === expectedTarget ? "correct" : "mispointed";
}

export function ensureSkillSymlink(config: Config): {
	action: "created" | "already_correct" | "skipped";
} {
	const status = skillSymlinkStatus(config);

	if (status === "correct") {
		return { action: "already_correct" };
	}

	if (status === "real_dir") {
		throw new StateError(
			"install.skill_dir_exists",
			`${SKILL_SYMLINK} already exists as a directory; back it up and remove it, then re-run --install.`,
			{ exitCode: 2, details: { path: SKILL_SYMLINK } },
		);
	}

	if (status === "mispointed") {
		const current = readlinkSync(SKILL_SYMLINK);
		throw new StateError(
			"install.skill_symlink_wrong",
			`${SKILL_SYMLINK} is a symlink pointing to ${current} — expected ${requireSrcDir(config)}/skill`,
			{
				exitCode: 2,
				details: { current, expected: `${requireSrcDir(config)}/skill` },
			},
		);
	}

	// absent — create it
	symlinkSync(`${requireSrcDir(config)}/skill`, SKILL_SYMLINK);
	return { action: "created" };
}

export function removeSkillSymlink(config: Config): { removed: boolean } {
	const status = skillSymlinkStatus(config);
	if (status !== "correct") {
		return { removed: false };
	}
	unlinkSync(SKILL_SYMLINK);
	return { removed: true };
}

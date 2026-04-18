import type { Config } from "../config.ts";
import { logInfo, PrereqError } from "../errors.ts";

export type Tool = "bun" | "gh" | "crontab" | "git";

export type ToolStatus = "ok" | "missing" | "unauth" | "old_version";

export interface PrereqRow {
	tool: Tool;
	status: ToolStatus;
	detail: string;
}

export interface PrereqResult {
	ok: boolean;
	rows: PrereqRow[];
}

async function which(cmd: string): Promise<boolean> {
	const proc = Bun.spawn({
		cmd: ["which", cmd],
		stdout: "pipe",
		stderr: "pipe",
	});
	const code = await proc.exited;
	return code === 0;
}

async function checkBun(): Promise<PrereqRow> {
	const found = await which("bun");
	if (!found) {
		return {
			tool: "bun",
			status: "missing",
			detail: "MISSING — tip: install from https://bun.sh",
		};
	}

	const proc = Bun.spawn({
		cmd: ["bun", "--version"],
		stdout: "pipe",
		stderr: "pipe",
	});
	await proc.exited;
	const raw = (await new Response(proc.stdout).text()).trim();
	// raw is e.g. "1.2.3"
	const parts = raw.split(".").map(Number);
	const major = parts[0] ?? 0;
	const minor = parts[1] ?? 0;
	const meetsMinimum = major > 1 || (major === 1 && minor >= 1);
	if (!meetsMinimum) {
		return {
			tool: "bun",
			status: "old_version",
			detail: `bun ${raw} — requires >= 1.1.0`,
		};
	}
	return { tool: "bun", status: "ok", detail: `bun ${raw}` };
}

async function checkGh(): Promise<PrereqRow> {
	const found = await which("gh");
	if (!found) {
		return {
			tool: "gh",
			status: "missing",
			detail: "MISSING — tip: install gh CLI",
		};
	}

	const proc = Bun.spawn({
		cmd: ["gh", "auth", "status"],
		stdout: "pipe",
		stderr: "pipe",
	});
	const code = await proc.exited;
	if (code !== 0) {
		return {
			tool: "gh",
			status: "unauth",
			detail: "not authenticated — tip: run gh auth login",
		};
	}

	// Parse the logged-in user from gh auth status output
	const stderr = await new Response(proc.stderr).text();
	const match = /Logged in to \S+ account (\S+)/i.exec(stderr);
	const user = match?.[1] ?? "authenticated";
	return { tool: "gh", status: "ok", detail: `logged in as ${user}` };
}

async function checkCrontab(): Promise<PrereqRow> {
	const found = await which("crontab");
	if (!found) {
		return {
			tool: "crontab",
			status: "missing",
			detail: "MISSING — tip: install a cron daemon",
		};
	}
	return { tool: "crontab", status: "ok", detail: "yes" };
}

async function checkGit(): Promise<PrereqRow> {
	const found = await which("git");
	if (!found) {
		return {
			tool: "git",
			status: "missing",
			detail: "MISSING — tip: install git",
		};
	}
	const proc = Bun.spawn({
		cmd: ["git", "--version"],
		stdout: "pipe",
		stderr: "pipe",
	});
	await proc.exited;
	const ver = (await new Response(proc.stdout).text()).trim();
	return { tool: "git", status: "ok", detail: ver };
}

export async function checkPrereqs(required: Set<Tool>): Promise<PrereqResult> {
	const checks: Array<Promise<PrereqRow>> = [];
	for (const tool of ["bun", "gh", "crontab", "git"] as const) {
		if (!required.has(tool)) continue;
		switch (tool) {
			case "bun":
				checks.push(checkBun());
				break;
			case "gh":
				checks.push(checkGh());
				break;
			case "crontab":
				checks.push(checkCrontab());
				break;
			case "git":
				checks.push(checkGit());
				break;
		}
	}

	const rows = await Promise.all(checks);
	const ok = rows.every((r) => r.status === "ok");
	return { ok, rows };
}

export function printPrereqTable(result: PrereqResult, config: Config): void {
	logInfo("Prerequisites:");
	for (const row of result.rows) {
		if (row.tool === "bun") {
			logInfo(`  - bun       >= 1.1.0         (detected: ${row.detail})`);
		} else if (row.tool === "gh") {
			logInfo(`  - gh        (authenticated)  (detected: ${row.detail})`);
		} else if (row.tool === "crontab") {
			logInfo(`  - crontab                    (detected: ${row.detail})`);
		} else {
			logInfo(`  - git                        (detected: ${row.detail})`);
		}
	}
	logInfo("Install paths:");
	logInfo(`  src      = ${config.srcDir}`);
	logInfo(`  binary   = ${config.binPath}`);
	logInfo(`  state    = ${config.stateDir}`);
	logInfo(`  cadence  = ${config.cadence}`);
}

export function assertPrereqs(result: PrereqResult): void {
	for (const row of result.rows) {
		if (row.status === "missing") {
			switch (row.tool) {
				case "bun":
					throw new PrereqError("prereq.missing_bun", "bun is required — install from https://bun.sh");
				case "gh":
					throw new PrereqError("prereq.missing_gh", "gh CLI is required — install gh CLI");
				case "crontab":
					throw new PrereqError("prereq.missing_crontab", "crontab is required — install a cron daemon");
				case "git":
					throw new PrereqError("prereq.missing_git", "git is required — install git");
			}
		}
		if (row.status === "unauth") {
			throw new PrereqError("prereq.gh_unauth", "gh is not authenticated — run gh auth login");
		}
		if (row.status === "old_version" && row.tool === "bun") {
			throw new PrereqError("prereq.missing_bun", `bun version too old: ${row.detail}`);
		}
	}
}

import { type Config, requireSrcDir } from "../config.ts";
import { PrereqError } from "../errors.ts";

export const SENTINEL_BEGIN = "# BEGIN review-loop-poller";
export const SENTINEL_END = "# END review-loop-poller";

export function hasBlock(cronText: string): boolean {
	return cronText.includes(SENTINEL_BEGIN) && cronText.includes(SENTINEL_END);
}

export function removeBlock(cronText: string): string {
	const lines = cronText.split("\n");
	const out: string[] = [];
	let inside = false;

	for (const line of lines) {
		if (line.trim() === SENTINEL_BEGIN) {
			inside = true;
			continue;
		}
		if (line.trim() === SENTINEL_END) {
			inside = false;
			continue;
		}
		if (!inside) {
			out.push(line);
		}
	}

	// Collapse sequences of more than one blank line into a single blank line
	const collapsed: string[] = [];
	let prevBlank = false;
	for (const line of out) {
		const isBlank = line.trim() === "";
		if (isBlank && prevBlank) continue;
		collapsed.push(line);
		prevBlank = isBlank;
	}

	// Trim trailing blank lines
	while (collapsed.length > 0 && collapsed[collapsed.length - 1]?.trim() === "") {
		collapsed.pop();
	}

	return collapsed.join("\n");
}

export function buildBlock(config: Config): string {
	const runSh = `${requireSrcDir(config)}/run.sh`;
	const prefix = config.providerName !== "github" ? `REVIEW_LOOP_POLLER_PROVIDER=${config.providerName} ` : "";
	const cronLine = `${config.cadence} ${prefix}${runSh} >> ${config.logFile} 2>&1`;
	return `${SENTINEL_BEGIN}\n${cronLine}\n${SENTINEL_END}`;
}

export async function readCrontab(): Promise<string> {
	const proc = Bun.spawn({
		cmd: ["crontab", "-l"],
		stdout: "pipe",
		stderr: "pipe",
	});

	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();

	if (exitCode === 0) {
		return stdout;
	}

	// crontab -l exits 1 with "no crontab for user" when there is no crontab — that's fine
	if (exitCode === 1 && /no crontab for/i.test(stderr)) {
		return "";
	}

	throw new PrereqError("install.crontab_read_failed", `crontab -l failed with exit ${exitCode}: ${stderr.trim()}`, {
		details: { exitCode, stderr: stderr.slice(0, 500) },
	});
}

export async function writeCrontab(text: string): Promise<void> {
	const proc = Bun.spawn({
		cmd: ["crontab", "-"],
		stdin: new TextEncoder().encode(text),
		stdout: "pipe",
		stderr: "pipe",
	});

	const exitCode = await proc.exited;
	const stderr = await new Response(proc.stderr).text();

	if (exitCode !== 0) {
		throw new PrereqError("install.crontab_write_failed", `crontab - failed with exit ${exitCode}: ${stderr.trim()}`, {
			details: { exitCode, stderr: stderr.slice(0, 500) },
		});
	}
}

import type { Config } from "../config.ts";
import { logInfo } from "../errors.ts";
import { readPending } from "../lib/pending.ts";

function relativeMinutes(iso: string, now: Date): string {
	const diffMs = now.getTime() - new Date(iso).getTime();
	const totalMinutes = Math.floor(diffMs / 60_000);

	if (totalMinutes < 60) {
		return `${totalMinutes} min ago`;
	}
	const hours = Math.floor(totalMinutes / 60);
	if (hours < 24) {
		return `${hours} hr ago`;
	}
	const days = Math.floor(hours / 24);
	return `${days} day${days === 1 ? "" : "s"} ago`;
}

function prRef(url: string): string {
	// url shape: https://github.com/owner/repo/pull/42
	try {
		const u = new URL(url);
		const parts = u.pathname.split("/").filter(Boolean);
		// parts: ["owner", "repo", "pull", "42"]
		const owner = parts[0] ?? "";
		const repo = parts[1] ?? "";
		const num = parts[3] ?? "";
		return `${owner}/${repo} #${num}`;
	} catch {
		return url;
	}
}

export async function cmdWhere(config: Config): Promise<void> {
	const now = new Date();
	const pending = await readPending(config);

	if (pending === null) {
		const hint = config.srcDir
			? `${config.srcDir}/run.sh --install`
			: "./run.sh --install from the ai-review-poller checkout";
		logInfo(`review-loop: no poller state yet — run ${hint}`);
		return;
	}

	if (pending.count === 0) {
		logInfo("review-loop: no PR reviews pending.");
		return;
	}

	const pollAgo = relativeMinutes(pending.updatedAt, now);
	const totalMinutesAgo = Math.floor((now.getTime() - new Date(pending.updatedAt).getTime()) / 60_000);
	const isStale = totalMinutesAgo > config.staleMinutes;

	const lines: string[] = [];

	if (isStale) {
		lines.push(`warning: poller last ran ${pollAgo} — results may be stale.`);
		lines.push("");
	}

	lines.push(
		`review-loop: ${pending.count} PR${pending.count === 1 ? "" : "s"} with pending Copilot reviews (poller last ran ${pollAgo})`,
	);

	for (const pr of pending.prs) {
		lines.push("");
		const ref = prRef(pr.url);
		lines.push(`  ${ref}  "${pr.title}"`);
		lines.push(`    ${pr.url}`);
		lines.push(`    review submitted ${pr.submittedAt} (${relativeMinutes(pr.submittedAt, now)})`);
	}

	lines.push("");
	lines.push("Run `/review-loop` inside each repo's checkout to process.");

	logInfo(lines.join("\n"));
}

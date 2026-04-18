import { mkdirSync } from "node:fs";
import type { Config } from "./config.ts";
import { DbError, logInfo, logWarn, StateError, setLogStateDir } from "./errors.ts";
import { openDb } from "./lib/db.ts";
import type { PendingPr } from "./lib/pending.ts";
import { writePending } from "./lib/pending.ts";
import { resolve } from "./providers/index.ts";

export async function runPoll(config: Config): Promise<void> {
	try {
		mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
	} catch (err) {
		throw new StateError("state.mkdir_failed", `failed to create state dir ${config.stateDir}`, {
			details: { path: config.stateDir },
			cause: err,
		});
	}

	setLogStateDir(config.stateDir);

	const provider = resolve(config.providerName);

	const token = await provider.getToken();

	const pullRequests = await provider.fetchOpenPullRequests(token);

	using db = openDb(config.dbFile);

	const seenSet = new Set<string>();
	const allSeen = db.selectSeen.all();
	for (const row of allSeen) {
		seenSet.add(`${row.pr_url}:${row.review_id}`);
	}

	const newPrs: PendingPr[] = [];
	const now = new Date().toISOString();

	const insertRows: Array<{
		$pr_url: string;
		$review_id: number;
		$seen_at: string;
	}> = [];

	for (const pr of pullRequests) {
		for (const review of pr.reviews) {
			if (review.authorLogin !== provider.botReviewerLogin) continue;
			if ((review as { state?: unknown }).state === "PENDING") continue;

			const key = `${pr.url}:${review.reviewId}`;
			if (seenSet.has(key)) continue;

			seenSet.add(key);
			newPrs.push({
				url: pr.url,
				title: pr.title,
				reviewId: review.reviewId,
				submittedAt: review.submittedAt,
			});
			insertRows.push({
				$pr_url: pr.url,
				$review_id: review.reviewId,
				$seen_at: now,
			});
		}
	}

	if (insertRows.length > 0) {
		const insertAll = db.transaction(() => {
			for (const row of insertRows) {
				try {
					db.insertSeen.run(row);
				} catch (err) {
					throw new DbError("db.insert_failed", `failed to insert review (${row.$pr_url}, ${row.$review_id})`, {
						details: { pr_url: row.$pr_url, review_id: row.$review_id },
						cause: err,
					});
				}
			}
		});
		insertAll();
	}

	const pending = {
		count: newPrs.length,
		updatedAt: now,
		prs: newPrs,
	};

	await writePending(config, pending);

	if (newPrs.length > 0) {
		logInfo(`poll: ${newPrs.length} new review(s) found`);
	} else {
		logWarn("poll: no new reviews; heartbeat written");
	}
}

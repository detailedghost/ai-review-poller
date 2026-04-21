import { mkdirSync } from "node:fs";
import type { Config } from "./config.ts";
import { DbError, logInfo, logWarn, StateError, setLogStateDir } from "./errors.ts";
import { openDb } from "./lib/db.ts";
import type { PendingAck, PendingPr } from "./lib/pending.ts";
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

	const pullRequests = await provider.fetchOpenPullRequests(token, {
		noFindingsPattern: config.noFindingsPattern,
	});

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

	// Acks are refreshed on every poll (no dedup). Keep only the newest ack
	// per PR so consumers see the current close-out signal, not a history.
	const latestAckByUrl = new Map<string, PendingAck>();
	for (const pr of pullRequests) {
		for (const ack of pr.acks ?? []) {
			const existing = latestAckByUrl.get(pr.url);
			if (existing === undefined || ack.createdAt > existing.createdAt) {
				latestAckByUrl.set(pr.url, {
					url: pr.url,
					title: pr.title,
					commentId: ack.commentId,
					createdAt: ack.createdAt,
					bodyExcerpt: ack.bodyExcerpt,
				});
			}
		}
	}
	const acks = Array.from(latestAckByUrl.values());

	const pending = {
		count: newPrs.length,
		updatedAt: now,
		prs: newPrs,
		...(acks.length > 0 ? { acks } : {}),
	};

	await writePending(config, pending);

	if (newPrs.length > 0) {
		logInfo(`poll: ${newPrs.length} new review(s) found`);
	} else if (acks.length > 0) {
		logInfo(`poll: no new reviews; ${acks.length} no-findings ack(s) tracked`);
	} else {
		logWarn("poll: no new reviews; heartbeat written");
	}
}

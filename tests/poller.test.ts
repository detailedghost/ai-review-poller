import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import { setLogStateDir } from "../src/errors.ts";
import { openDb } from "../src/lib/db.ts";
import { readPending } from "../src/lib/pending.ts";
import { runPoll } from "../src/poller.ts";
import { registry } from "../src/providers/index.ts";
import type { ReviewProvider } from "../src/providers/types.ts";
import { fakeProvider, mockEnv, scratchStateDir } from "./_helpers.ts";

let stateDir: string;

beforeEach(() => {
	stateDir = scratchStateDir("poller");
});

afterEach(() => {
	setLogStateDir("" as unknown as string);
	rmSync(stateDir, { recursive: true, force: true });
});

function makeConfig(dir: string) {
	return loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STATE_DIR: dir }));
}

/**
 * Temporarily replaces the 'github' registry slot with a fake provider for a
 * single test, restoring it in a finally block.
 */
async function withFakeProvider<T>(provider: ReviewProvider, fn: () => Promise<T>): Promise<T> {
	const saved = registry.github;
	registry.github = provider;
	try {
		return await fn();
	} finally {
		if (saved) registry.github = saved;
	}
}

const COPILOT = "copilot-pull-request-reviewer";
const PR_URL = "https://github.com/owner/repo/pull/10";
const NOW = new Date().toISOString();

describe("poller integration — cold run", () => {
	test("cold run: 1 new Copilot review writes pending.json with count 1", async () => {
		const cfg = makeConfig(stateDir);
		const provider = fakeProvider([
			{
				pr_url: PR_URL,
				review_id: 1001,
				submittedAt: NOW,
				authorLogin: COPILOT,
			},
		]);
		await withFakeProvider(provider, async () => {
			await runPoll(cfg);
		});

		const pending = await readPending(cfg);
		expect(pending).not.toBeNull();
		expect(pending?.count).toBe(1);
	});

	test("cold run: 1 new Copilot review inserts 1 SQLite row", async () => {
		const cfg = makeConfig(stateDir);
		const provider = fakeProvider([
			{
				pr_url: PR_URL,
				review_id: 2001,
				submittedAt: NOW,
				authorLogin: COPILOT,
			},
		]);
		await withFakeProvider(provider, async () => {
			await runPoll(cfg);
		});

		using db = openDb(cfg.dbFile);
		const rows = db.selectSeen.all();
		expect(rows.length).toBe(1);
	});
});

describe("poller integration — warm run (dedup)", () => {
	test("second run with same review writes count 0 and still 1 SQLite row", async () => {
		const cfg = makeConfig(stateDir);
		const provider = fakeProvider([
			{
				pr_url: PR_URL,
				review_id: 3001,
				submittedAt: NOW,
				authorLogin: COPILOT,
			},
		]);
		await withFakeProvider(provider, async () => {
			await runPoll(cfg); // first run
			await runPoll(cfg); // second run — same review, should dedup
		});

		const pending = await readPending(cfg);
		expect(pending?.count).toBe(0);

		using db = openDb(cfg.dbFile);
		const rows = db.selectSeen.all();
		expect(rows.length).toBe(1);
	});
});

describe("poller integration — zero PRs", () => {
	test("zero PRs writes pending.json with count 0", async () => {
		const cfg = makeConfig(stateDir);
		await withFakeProvider(fakeProvider([]), async () => {
			await runPoll(cfg);
		});
		const pending = await readPending(cfg);
		expect(pending?.count).toBe(0);
	});

	test("zero PRs: updatedAt is written (heartbeat)", async () => {
		const cfg = makeConfig(stateDir);
		const before = Date.now();
		await withFakeProvider(fakeProvider([]), async () => {
			await runPoll(cfg);
		});
		const pending = await readPending(cfg);
		const updatedAt = new Date(pending?.updatedAt ?? "").getTime();
		expect(updatedAt).toBeGreaterThanOrEqual(before);
	});
});

describe("poller integration — missing state dir", () => {
	test("state dir missing on run is recreated and poll succeeds", async () => {
		const cfg = makeConfig(stateDir);
		// Remove the dir that beforeEach created
		rmSync(stateDir, { recursive: true, force: true });

		await withFakeProvider(fakeProvider([]), async () => {
			// Should not throw — runPoll recreates the dir
			await runPoll(cfg);
		});

		const pending = await readPending(cfg);
		expect(pending).not.toBeNull();
	});
});

describe("poller integration — no-findings acks", () => {
	test("ack from provider lands in pending.acks and does not inflate count", async () => {
		const cfg = makeConfig(stateDir);
		const provider = fakeProvider([], {
			[PR_URL]: [
				{
					commentId: 9001,
					createdAt: NOW,
					authorLogin: "copilot-swe-agent",
					bodyExcerpt: "No additional code changes were needed",
				},
			],
		});
		await withFakeProvider(provider, async () => {
			await runPoll(cfg);
		});

		const pending = await readPending(cfg);
		expect(pending?.count).toBe(0);
		expect(pending?.acks?.length).toBe(1);
		expect(pending?.acks?.[0]?.url).toBe(PR_URL);
		expect(pending?.acks?.[0]?.commentId).toBe(9001);
	});

	test("only the newest ack per PR is kept", async () => {
		const cfg = makeConfig(stateDir);
		const older = "2026-04-20T10:00:00Z";
		const newer = "2026-04-21T10:00:00Z";
		const provider = fakeProvider([], {
			[PR_URL]: [
				{
					commentId: 1,
					createdAt: older,
					authorLogin: "copilot-swe-agent",
					bodyExcerpt: "old",
				},
				{
					commentId: 2,
					createdAt: newer,
					authorLogin: "copilot-swe-agent",
					bodyExcerpt: "new",
				},
			],
		});
		await withFakeProvider(provider, async () => {
			await runPoll(cfg);
		});

		const pending = await readPending(cfg);
		expect(pending?.acks?.length).toBe(1);
		expect(pending?.acks?.[0]?.commentId).toBe(2);
		expect(pending?.acks?.[0]?.createdAt).toBe(newer);
	});
});

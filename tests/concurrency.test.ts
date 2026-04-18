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
	stateDir = scratchStateDir("concurrency");
	setLogStateDir(stateDir);
});

afterEach(() => {
	setLogStateDir("" as unknown as string);
	rmSync(stateDir, { recursive: true, force: true });
});

function makeConfig(dir: string) {
	return loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STATE_DIR: dir }));
}

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
const PR_URL = "https://github.com/owner/repo/pull/99";
const NOW = new Date().toISOString();

describe("concurrency — two parallel runPoll invocations", () => {
	test("two concurrent runPoll calls produce valid pending.json and no SQLite PK violations", async () => {
		const cfg = makeConfig(stateDir);
		const provider = fakeProvider([{ pr_url: PR_URL, review_id: 9001, submittedAt: NOW, authorLogin: COPILOT }]);

		let error: unknown;
		await withFakeProvider(provider, async () => {
			try {
				// Launch two polls in parallel — both race to insert the same review
				await Promise.all([runPoll(cfg), runPoll(cfg)]);
			} catch (e) {
				error = e;
			}
		});

		// No unhandled error
		expect(error).toBeUndefined();

		// pending.json is parseable JSON
		const pending = await readPending(cfg);
		expect(pending).not.toBeNull();
		expect(typeof pending?.count).toBe("number");
		expect(typeof pending?.updatedAt).toBe("string");
		expect(Array.isArray(pending?.prs)).toBe(true);

		// SQLite has no PK violations — dedup means exactly 1 row
		using db = openDb(cfg.dbFile);
		const rows = db.selectSeen.all();
		expect(rows.length).toBe(1);
	});

	test("concurrent zero-PR polls both succeed and leave valid pending.json", async () => {
		const cfg = makeConfig(stateDir);
		const provider = fakeProvider([]);

		let error: unknown;
		await withFakeProvider(provider, async () => {
			try {
				await Promise.all([runPoll(cfg), runPoll(cfg)]);
			} catch (e) {
				error = e;
			}
		});

		expect(error).toBeUndefined();
		const pending = await readPending(cfg);
		expect(pending).not.toBeNull();
		expect(pending?.count).toBe(0);
	});
});

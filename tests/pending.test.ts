import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, statSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import { StateError } from "../src/errors.ts";
import type { Pending } from "../src/lib/pending.ts";
import { readPending, writePending } from "../src/lib/pending.ts";
import { mockEnv, scratchStateDir } from "./_helpers.ts";

let stateDir: string;

function makeConfig(dir: string) {
	return loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STATE_DIR: dir }));
}

const SAMPLE_PENDING: Pending = {
	count: 1,
	updatedAt: new Date().toISOString(),
	prs: [
		{
			url: "https://github.com/a/b/pull/1",
			title: "Test PR",
			reviewId: 42,
			submittedAt: new Date().toISOString(),
		},
	],
};

beforeEach(() => {
	stateDir = scratchStateDir("pending");
});

afterEach(() => {
	rmSync(stateDir, { recursive: true, force: true });
});

describe("writePending — happy path", () => {
	test("writes a JSON file at the pending path", async () => {
		const cfg = makeConfig(stateDir);
		await writePending(cfg, SAMPLE_PENDING);
		const file = Bun.file(cfg.pendingFile);
		expect(await file.exists()).toBe(true);
	});

	test("written file is valid JSON matching the payload", async () => {
		const cfg = makeConfig(stateDir);
		await writePending(cfg, SAMPLE_PENDING);
		const text = await Bun.file(cfg.pendingFile).text();
		const parsed = JSON.parse(text) as Pending;
		expect(parsed.count).toBe(1);
		expect(parsed.prs[0]?.url).toBe("https://github.com/a/b/pull/1");
	});

	test("pending.json file mode is 0600", async () => {
		const cfg = makeConfig(stateDir);
		await writePending(cfg, SAMPLE_PENDING);
		const mode = statSync(cfg.pendingFile).mode & 0o777;
		expect(mode).toBe(0o600);
	});
});

describe("writePending — atomic write", () => {
	test("final file unchanged when renameSync fails (dest is a non-empty directory)", async () => {
		const cfg = makeConfig(stateDir);
		await writePending(cfg, { ...SAMPLE_PENDING, count: 0, prs: [] });
		const originalText = await Bun.file(cfg.pendingFile).text();

		const { rmSync, mkdirSync, writeFileSync } = await import("node:fs");
		rmSync(cfg.pendingFile);
		mkdirSync(cfg.pendingFile);
		writeFileSync(`${cfg.pendingFile}/guard`, "block rename");

		try {
			await writePending(cfg, { ...SAMPLE_PENDING, count: 99, prs: [] });
		} catch {
			// expected StateError
		}

		rmSync(`${cfg.pendingFile}/guard`);
		rmSync(cfg.pendingFile, { recursive: true });
		await writePending(cfg, { ...SAMPLE_PENDING, count: 0, prs: [] });
		const afterText = await Bun.file(cfg.pendingFile).text();
		expect(JSON.parse(afterText).count).toBe(JSON.parse(originalText).count);
	});

	test("throws state.rename_failed when rename fails", async () => {
		const cfg = makeConfig(stateDir);
		const { mkdirSync, writeFileSync } = await import("node:fs");
		mkdirSync(cfg.pendingFile, { recursive: true });
		writeFileSync(`${cfg.pendingFile}/guard`, "block rename");

		let caught: unknown;
		try {
			await writePending(cfg, SAMPLE_PENDING);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(StateError);
		expect((caught as StateError).code).toBe("state.rename_failed");
	});
});

describe("readPending — happy path and edge cases", () => {
	test("returns null for missing pending.json", async () => {
		const cfg = makeConfig(stateDir);
		const result = await readPending(cfg);
		expect(result).toBeNull();
	});

	test("returns parsed object for valid pending.json", async () => {
		const cfg = makeConfig(stateDir);
		await writePending(cfg, SAMPLE_PENDING);
		const result = await readPending(cfg);
		expect(result).not.toBeNull();
		expect(result?.count).toBe(1);
	});

	test("throws state.malformed_pending for invalid JSON content", async () => {
		const cfg = makeConfig(stateDir);
		writeFileSync(cfg.pendingFile, "{ invalid json !!!", "utf8");
		let caught: unknown;
		try {
			await readPending(cfg);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(StateError);
		expect((caught as StateError).code).toBe("state.malformed_pending");
	});

	test("throws state.malformed_pending for truncated JSON", async () => {
		const cfg = makeConfig(stateDir);
		writeFileSync(cfg.pendingFile, '{"count":1,"updatedAt":"2026', "utf8");
		let caught: unknown;
		try {
			await readPending(cfg);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(StateError);
		expect((caught as StateError).code).toBe("state.malformed_pending");
	});
});

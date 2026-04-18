import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { setLogStateDir } from "../src/errors.ts";
import { scratchStateDir } from "./_helpers.ts";

// TODO(cli-agent): cmdWhere is not yet implemented in src/commands/where.ts.
// These tests are structured against the spec contract. When cmdWhere is
// exported, remove the test.skip wrappers and wire up the import.

let stateDir: string;

beforeEach(() => {
	stateDir = scratchStateDir("where");
	setLogStateDir(stateDir);
});

afterEach(() => {
	setLogStateDir("" as unknown as string);
	rmSync(stateDir, { recursive: true, force: true });
});

describe("cmdWhere — pending.json missing", () => {
	test.skip("missing pending.json prints install tip and exits 0", async () => {
		// TODO(cli-agent): import { cmdWhere } from "../src/commands/where.ts";
		// const cfg = loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STATE_DIR: stateDir }));
		// const output: string[] = [];
		// await cmdWhere(cfg, (line) => output.push(line));
		// expect(output.join("\n")).toContain("--install");
	});
});

describe("cmdWhere — count 0", () => {
	test.skip("count: 0 prints 'no PR reviews pending' and exits 0", async () => {
		// TODO(cli-agent): import { cmdWhere } from "../src/commands/where.ts";
		// const cfg = loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STATE_DIR: stateDir }));
		// writeFileSync(cfg.pendingFile, JSON.stringify({ count: 0, updatedAt: new Date().toISOString(), prs: [] }), "utf8");
		// const output: string[] = [];
		// await cmdWhere(cfg, (line) => output.push(line));
		// expect(output.join("\n")).toContain("no PR reviews pending");
	});
});

describe("cmdWhere — count 2 fresh", () => {
	test.skip("count: 2 with fresh updatedAt shows formatted list without stale warning", async () => {
		// TODO(cli-agent): import { cmdWhere } from "../src/commands/where.ts";
		// const cfg = loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STATE_DIR: stateDir }));
		// writeFileSync(cfg.pendingFile, JSON.stringify({
		//   count: 2, updatedAt: new Date().toISOString(),
		//   prs: [
		//     { url: "https://github.com/owner/repo-a/pull/42", title: "Add OAuth", reviewId: 1, submittedAt: new Date().toISOString() },
		//     { url: "https://github.com/owner/repo-b/pull/7", title: "Fix migration", reviewId: 2, submittedAt: new Date().toISOString() },
		//   ],
		// }), "utf8");
		// const output: string[] = [];
		// await cmdWhere(cfg, (line) => output.push(line));
		// const text = output.join("\n");
		// expect(text).toContain("2 PRs");
		// expect(text).toContain("repo-a");
		// expect(text).not.toContain("stale");
	});
});

describe("cmdWhere — count 2 stale", () => {
	test.skip("updatedAt 61 min ago prepends stale warning", async () => {
		// TODO(cli-agent): import { cmdWhere } from "../src/commands/where.ts";
		// const staleDate = new Date(Date.now() - 61 * 60 * 1000).toISOString();
		// const cfg = loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STATE_DIR: stateDir }));
		// writeFileSync(cfg.pendingFile, JSON.stringify({
		//   count: 1, updatedAt: staleDate,
		//   prs: [{ url: "https://github.com/o/r/pull/1", title: "P", reviewId: 1, submittedAt: staleDate }],
		// }), "utf8");
		// const output: string[] = [];
		// await cmdWhere(cfg, (line) => output.push(line));
		// expect(output.join("\n")).toContain("stale");
	});
});

describe("cmdWhere — malformed pending.json", () => {
	test("malformed pending.json throws StateError state.malformed_pending", async () => {
		const { loadConfig } = await import("../src/config.ts");
		const { StateError } = await import("../src/errors.ts");
		const { mockEnv } = await import("./_helpers.ts");
		const { readPending } = await import("../src/lib/pending.ts");
		const cfg = loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STATE_DIR: stateDir }));
		writeFileSync(cfg.pendingFile, "not-json", "utf8");
		let caught: unknown;
		try {
			await readPending(cfg);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(StateError);
		expect((caught as InstanceType<typeof StateError>).code).toBe("state.malformed_pending");
	});
});

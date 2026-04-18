import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import { buildBlock, hasBlock, removeBlock, SENTINEL_BEGIN, SENTINEL_END } from "../src/lib/crontab.ts";
import { mockEnv, scratchStateDir } from "./_helpers.ts";

let stateDir: string;
let shimDir: string;
let fakeCrontabFile: string;

beforeEach(() => {
	stateDir = scratchStateDir("install");
	shimDir = `${stateDir}/bin`;
	fakeCrontabFile = `${stateDir}/fake-crontab.txt`;
	mkdirSync(shimDir, { recursive: true });

	// Write initial empty crontab file
	writeFileSync(fakeCrontabFile, "", "utf8");

	// Write a crontab shim that reads/writes the fake file
	const shimPath = `${shimDir}/crontab`;
	writeFileSync(
		shimPath,
		`#!/bin/sh
CRONTAB_FILE="${fakeCrontabFile}"
if [ "$1" = "-l" ]; then
  cat "$CRONTAB_FILE" 2>/dev/null || true
elif [ "$1" = "-" ]; then
  cat > "$CRONTAB_FILE"
fi
`,
		"utf8",
	);
	Bun.spawnSync(["chmod", "+x", shimPath]);

	// Prepend shimDir to PATH so crontab commands use our shim
	process.env.PATH = `${shimDir}:${process.env.PATH}`;
});

afterEach(() => {
	// Restore PATH
	process.env.PATH = process.env.PATH?.replace(`${shimDir}:`, "") ?? process.env.PATH;
	rmSync(stateDir, { recursive: true, force: true });
});

function makeConfig(dir: string, overrides: Record<string, string> = {}) {
	return loadConfig(
		mockEnv({
			REVIEW_LOOP_POLLER_STATE_DIR: dir,
			REVIEW_LOOP_POLLER_SRC: "/test/src/ai-review-poller",
			...overrides,
		}),
	);
}

describe("crontab sentinel — hasBlock", () => {
	test("hasBlock returns false for empty crontab", () => {
		expect(hasBlock("")).toBe(false);
	});

	test("hasBlock returns true when sentinel block is present", () => {
		const text = `${SENTINEL_BEGIN}\n*/5 * * * * /some/run.sh\n${SENTINEL_END}`;
		expect(hasBlock(text)).toBe(true);
	});

	test("hasBlock returns false when only BEGIN is present", () => {
		expect(hasBlock(`${SENTINEL_BEGIN}\nsome line`)).toBe(false);
	});
});

describe("crontab sentinel — removeBlock", () => {
	test("removeBlock strips the sentinel block", () => {
		const text = `before\n${SENTINEL_BEGIN}\n*/5 * * * * /run.sh\n${SENTINEL_END}\nafter`;
		const result = removeBlock(text);
		expect(result).not.toContain(SENTINEL_BEGIN);
		expect(result).not.toContain(SENTINEL_END);
		expect(result).toContain("before");
		expect(result).toContain("after");
	});

	test("removeBlock is a no-op when no block present", () => {
		const text = "line1\nline2";
		expect(removeBlock(text)).toBe(text);
	});

	test("removeBlock collapses consecutive blank lines", () => {
		const text = `line1\n\n${SENTINEL_BEGIN}\ncron\n${SENTINEL_END}\n\n\nline2`;
		const result = removeBlock(text);
		// Should not have more than one consecutive blank line
		expect(result).not.toContain("\n\n\n");
	});

	test("removeBlock trims trailing blank lines", () => {
		const text = `line1\n${SENTINEL_BEGIN}\ncron\n${SENTINEL_END}\n\n`;
		const result = removeBlock(text);
		expect(result.endsWith("\n")).toBe(false);
	});
});

describe("crontab sentinel — buildBlock", () => {
	test("buildBlock generates exactly 3 lines (BEGIN + cron + END)", () => {
		const cfg = makeConfig(stateDir);
		const block = buildBlock(cfg);
		const lines = block.split("\n");
		expect(lines.length).toBe(3);
	});

	test("buildBlock first line is BEGIN sentinel", () => {
		const cfg = makeConfig(stateDir);
		const block = buildBlock(cfg);
		const lines = block.split("\n");
		expect(lines[0]).toBe(SENTINEL_BEGIN);
	});

	test("buildBlock last line is END sentinel", () => {
		const cfg = makeConfig(stateDir);
		const block = buildBlock(cfg);
		const lines = block.split("\n");
		expect(lines[2]).toBe(SENTINEL_END);
	});

	test("buildBlock cron line contains the cadence", () => {
		const cfg = makeConfig(stateDir, {
			REVIEW_LOOP_POLLER_CADENCE: "0 * * * *",
		});
		const block = buildBlock(cfg);
		const lines = block.split("\n");
		expect(lines[1]).toContain("0 * * * *");
	});

	test("buildBlock does NOT prepend provider env for default 'github' provider", () => {
		const cfg = makeConfig(stateDir);
		const block = buildBlock(cfg);
		expect(block).not.toContain("REVIEW_LOOP_POLLER_PROVIDER=");
	});

	test("buildBlock prepends REVIEW_LOOP_POLLER_PROVIDER when provider is non-default", () => {
		const cfg = makeConfig(stateDir, { REVIEW_LOOP_POLLER_PROVIDER: "gitlab" });
		const block = buildBlock(cfg);
		expect(block).toContain("REVIEW_LOOP_POLLER_PROVIDER=gitlab");
	});
});

describe("crontab sentinel — idempotency via readCrontab/writeCrontab", () => {
	test("adding the block twice results in exactly one block", async () => {
		const cfg = makeConfig(stateDir);
		const { readCrontab, writeCrontab } = await import("../src/lib/crontab.ts");

		// First install
		const current1 = await readCrontab();
		const stripped1 = removeBlock(current1);
		await writeCrontab(`${stripped1}\n${buildBlock(cfg)}\n`);

		// Second install (idempotent)
		const current2 = await readCrontab();
		const stripped2 = removeBlock(current2);
		await writeCrontab(`${stripped2}\n${buildBlock(cfg)}\n`);

		const final = await readCrontab();
		// Should contain exactly one BEGIN and one END
		const beginCount = (final.match(new RegExp(SENTINEL_BEGIN, "g")) ?? []).length;
		const endCount = (final.match(new RegExp(SENTINEL_END, "g")) ?? []).length;
		expect(beginCount).toBe(1);
		expect(endCount).toBe(1);
	});

	test("uninstall twice is a no-op on the second call", async () => {
		const cfg = makeConfig(stateDir);
		const { readCrontab, writeCrontab } = await import("../src/lib/crontab.ts");

		// First install then uninstall
		await writeCrontab(`${buildBlock(cfg)}\n`);
		const after1 = await readCrontab();
		await writeCrontab(`${removeBlock(after1)}\n`);

		const afterUninstall1 = await readCrontab();
		expect(hasBlock(afterUninstall1)).toBe(false);

		// Second uninstall — no-op
		const stripped2 = removeBlock(afterUninstall1);
		await writeCrontab(`${stripped2}\n`);
		const afterUninstall2 = await readCrontab();
		expect(hasBlock(afterUninstall2)).toBe(false);
	});
});

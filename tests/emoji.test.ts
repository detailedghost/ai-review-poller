import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { logError, logInfo, logWarn, NetworkError, setLogStateDir } from "../src/errors.ts";
import { canonicalLog, lastLogEntry, scratchStateDir } from "./_helpers.ts";

let stateDir: string;

beforeEach(() => {
	stateDir = scratchStateDir("emoji");
	setLogStateDir(stateDir);
});

afterEach(() => {
	setLogStateDir("" as unknown as string);
	rmSync(stateDir, { recursive: true, force: true });
});

describe("emoji — stable level mapping", () => {
	test("info level produces the info emoji in message", () => {
		logInfo("test info");
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(entry.message).toContain("ℹ️");
	});

	test("warn level produces the warn emoji in message", () => {
		logWarn("test warn");
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(entry.message).toContain("⚠️");
	});

	test("error level produces the error emoji in message", () => {
		logError(new NetworkError("network.timeout", "timeout"));
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(entry.message).toContain("❌");
	});
});

describe("emoji — structured fields remain ASCII-pure", () => {
	test("level field contains no emoji for info", () => {
		logInfo("check level");
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(entry.level).toBe("info");
	});

	test("level field contains no emoji for warn", () => {
		logWarn("check level");
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(entry.level).toBe("warn");
	});

	test("level field contains no emoji for error", () => {
		logError(new NetworkError("network.fetch_failed", "fail"));
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(entry.level).toBe("error");
	});

	test("code field contains no emoji", () => {
		logError(new NetworkError("network.fetch_failed", "fail"));
		const entry = lastLogEntry(`${stateDir}/log`);
		// code must be ASCII-only (a-z, dots, hyphens, underscores) for jq '.code' to remain clean
		expect(entry.code).toMatch(/^[a-z._-]+$/);
	});

	test("ts field contains no emoji", () => {
		logInfo("check ts");
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});

describe("emoji — every log line parses as valid JSON", () => {
	test("all lines written by logInfo/logWarn/logError are JSON.parse-able", () => {
		logInfo("info line");
		logWarn("warn line");
		logError(new NetworkError("network.timeout", "timed out"));
		const entries = canonicalLog(`${stateDir}/log`);
		expect(entries.length).toBe(3);
		// canonicalLog already uses JSON.parse internally; if any line was unparseable
		// it would have thrown. We additionally assert each has the required shape.
		for (const entry of entries) {
			expect(typeof entry.ts).toBe("string");
			expect(["info", "warn", "error"]).toContain(entry.level);
			expect(typeof entry.message).toBe("string");
		}
	});

	test("raw log file lines are each valid JSON when parsed independently", () => {
		logInfo("raw line test");
		logWarn("another line");
		const { readFileSync } = require("node:fs") as typeof import("node:fs");
		const raw = readFileSync(`${stateDir}/log`, "utf8");
		const lines = raw.split("\n").filter((l: string) => l.trim().length > 0);
		for (const line of lines) {
			expect(() => JSON.parse(line)).not.toThrow();
		}
	});
});

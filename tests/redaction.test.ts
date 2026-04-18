import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { logError, logInfo, logWarn, NetworkError, setLogStateDir } from "../src/errors.ts";
import { canonicalLog, scratchStateDir } from "./_helpers.ts";

const CANNED_TOKEN = "tok-REDACTME-FAKE-XYZ";
const BEARER_TOKEN = `Bearer ${CANNED_TOKEN}`;

let stateDir: string;

beforeEach(() => {
	stateDir = scratchStateDir("redaction");
	setLogStateDir(stateDir);
});

afterEach(() => {
	setLogStateDir("" as unknown as string);
	rmSync(stateDir, { recursive: true, force: true });
});

function logText(): string {
	return JSON.stringify(canonicalLog(`${stateDir}/log`));
}

describe("redaction — token never appears in log output", () => {
	test("logInfo with Bearer token in details value is redacted", () => {
		logInfo("check", { authHeader: BEARER_TOKEN });
		expect(logText()).not.toContain(CANNED_TOKEN);
	});

	test("logWarn with Bearer token in details value is redacted", () => {
		logWarn("check", { authHeader: BEARER_TOKEN });
		expect(logText()).not.toContain(CANNED_TOKEN);
	});

	test("logError with Bearer token in details value is redacted", () => {
		logError(new NetworkError("network.fetch_failed", "fail", { details: { auth: BEARER_TOKEN } }));
		expect(logText()).not.toContain(CANNED_TOKEN);
	});

	test("logInfo with {token: ...} key — value is redacted", () => {
		logInfo("check", { token: CANNED_TOKEN });
		expect(logText()).not.toContain(CANNED_TOKEN);
	});

	test("logInfo with {authorization: ...} key — value is redacted", () => {
		logInfo("check", { authorization: CANNED_TOKEN });
		expect(logText()).not.toContain(CANNED_TOKEN);
	});

	test("logInfo with {auth: ...} key — value is redacted", () => {
		logInfo("check", { auth: CANNED_TOKEN });
		expect(logText()).not.toContain(CANNED_TOKEN);
	});

	test("Bearer ghp_... pattern in string value is redacted", () => {
		logInfo("request", { header: `Authorization: ${BEARER_TOKEN}` });
		expect(logText()).not.toContain(CANNED_TOKEN);
	});

	test("{token: x} — token value absent from log", () => {
		logInfo("test", { token: "x-secret-value-abc123" });
		expect(logText()).not.toContain("x-secret-value-abc123");
	});

	test("{authorization: y} — authorization value absent from log", () => {
		logInfo("test", { authorization: "y-auth-value-xyz789" });
		expect(logText()).not.toContain("y-auth-value-xyz789");
	});

	test("non-sensitive details key is NOT redacted", () => {
		logInfo("test", { pr_url: "https://github.com/a/b/pull/1" });
		expect(logText()).toContain("https://github.com/a/b/pull/1");
	});

	test("redacted entries contain [REDACTED] placeholder", () => {
		logInfo("test", { token: CANNED_TOKEN });
		expect(logText()).toContain("[REDACTED]");
	});
});

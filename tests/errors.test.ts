import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { rmSync } from "node:fs";
import {
	ApiError,
	AuthError,
	ConfigError,
	DbError,
	logError,
	logInfo,
	logWarn,
	NetworkError,
	PollerError,
	PrereqError,
	ProviderError,
	runSafely,
	StateError,
	setLogStateDir,
} from "../src/errors.ts";
import { canonicalLog, findLogEntry, lastLogEntry, scratchStateDir } from "./_helpers.ts";

let stateDir: string;

beforeEach(() => {
	stateDir = scratchStateDir("errors");
	setLogStateDir(stateDir);
});

afterEach(() => {
	setLogStateDir("" as unknown as string);
	rmSync(stateDir, { recursive: true, force: true });
});

describe("PollerError subclasses — code and exitCode", () => {
	test("ConfigError has exitCode 2", () => {
		const e = new ConfigError("config.bad_env", "bad env");
		expect(e.exitCode).toBe(2);
		expect(e.code).toBe("config.bad_env");
		expect(e).toBeInstanceOf(PollerError);
	});

	test("AuthError has exitCode 1", () => {
		const e = new AuthError("auth.token_cmd_failed", "auth fail");
		expect(e.exitCode).toBe(1);
		expect(e.code).toBe("auth.token_cmd_failed");
		expect(e).toBeInstanceOf(PollerError);
	});

	test("NetworkError has exitCode 1", () => {
		const e = new NetworkError("network.fetch_failed", "net fail");
		expect(e.exitCode).toBe(1);
		expect(e.code).toBe("network.fetch_failed");
		expect(e).toBeInstanceOf(PollerError);
	});

	test("ApiError has exitCode 1", () => {
		const e = new ApiError("api.http_status", "api fail");
		expect(e.exitCode).toBe(1);
		expect(e.code).toBe("api.http_status");
		expect(e).toBeInstanceOf(PollerError);
	});

	test("DbError has exitCode 3", () => {
		const e = new DbError("db.open_failed", "db fail");
		expect(e.exitCode).toBe(3);
		expect(e.code).toBe("db.open_failed");
		expect(e).toBeInstanceOf(PollerError);
	});

	test("StateError has exitCode 3 by default", () => {
		const e = new StateError("state.rename_failed", "state fail");
		expect(e.exitCode).toBe(3);
		expect(e.code).toBe("state.rename_failed");
		expect(e).toBeInstanceOf(PollerError);
	});

	test("StateError exitCode can be overridden to 2", () => {
		const e = new StateError("install.skill_dir_exists", "dir exists", {
			exitCode: 2,
		});
		expect(e.exitCode).toBe(2);
	});

	test("PrereqError has exitCode 2", () => {
		const e = new PrereqError("prereq.missing_bun", "missing bun");
		expect(e.exitCode).toBe(2);
		expect(e.code).toBe("prereq.missing_bun");
		expect(e).toBeInstanceOf(PollerError);
	});

	test("ProviderError has exitCode 2", () => {
		const e = new ProviderError("provider.unknown", "unknown provider");
		expect(e.exitCode).toBe(2);
		expect(e.code).toBe("provider.unknown");
		expect(e).toBeInstanceOf(PollerError);
	});

	test("PollerError stores details", () => {
		const e = new PollerError("runtime.unexpected", "msg", {
			details: { foo: "bar" },
		});
		expect(e.details).toEqual({ foo: "bar" });
	});

	test("PollerError stores cause", () => {
		const cause = new Error("root cause");
		const e = new ApiError("api.graphql_errors", "graphql err", { cause });
		expect(e.cause).toBe(cause);
	});
});

describe("logger — writes JSON lines to log file", () => {
	test("logInfo writes a parseable JSON line with level=info", () => {
		logInfo("test info message");
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(entry.level).toBe("info");
		expect(typeof entry.ts).toBe("string");
	});

	test("logWarn writes a parseable JSON line with level=warn", () => {
		logWarn("test warn message");
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(entry.level).toBe("warn");
	});

	test("logError writes a parseable JSON line with level=error", () => {
		logError(new ApiError("api.http_status", "http fail"));
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(entry.level).toBe("error");
		expect(entry.code).toBe("api.http_status");
	});

	test("logInfo message contains info emoji prefix", () => {
		logInfo("progress message");
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(entry.message).toContain("ℹ️");
	});

	test("logWarn message contains warn emoji prefix", () => {
		logWarn("recoverable oddity");
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(entry.message).toContain("⚠️");
	});

	test("logError message contains error emoji prefix", () => {
		logError(new NetworkError("network.timeout", "timed out"));
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(entry.message).toContain("❌");
	});

	test("emoji prefixes do NOT appear in level field", () => {
		logInfo("test");
		logWarn("test");
		logError(new ConfigError("config.bad_env", "bad"));
		const entries = canonicalLog(`${stateDir}/log`);
		for (const entry of entries) {
			expect(entry.level).toMatch(/^(info|warn|error)$/);
		}
	});

	test("emoji prefixes do NOT appear in code field", () => {
		logError(new DbError("db.open_failed", "fail"));
		const entry = findLogEntry(`${stateDir}/log`, "db.open_failed");
		expect(entry.code).toBe("db.open_failed");
	});

	test("ts field is a valid ISO string", () => {
		logInfo("timestamp test");
		const entry = lastLogEntry(`${stateDir}/log`);
		const d = new Date(entry.ts);
		expect(Number.isNaN(d.getTime())).toBe(false);
	});
});

describe("token redaction", () => {
	test("Bearer token in details value is redacted", () => {
		logInfo("auth check", {
			authHeader: "Bearer tok-REDACTME-FAKE",
		});
		const entry = lastLogEntry(`${stateDir}/log`);
		const text = JSON.stringify(entry);
		expect(text).not.toContain("tok-REDACTME-FAKE");
		expect(text).toContain("[REDACTED]");
	});

	test("details key named 'token' is redacted", () => {
		logInfo("token test", { token: "secret-token-value" });
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(JSON.stringify(entry.details)).not.toContain("secret-token-value");
		expect(JSON.stringify(entry.details)).toContain("[REDACTED]");
	});

	test("details key named 'authorization' is redacted", () => {
		logInfo("auth test", { authorization: "Bearer ghp_abc" });
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(JSON.stringify(entry.details)).not.toContain("Bearer ghp_abc");
		expect(JSON.stringify(entry.details)).toContain("[REDACTED]");
	});

	test("details key named 'auth' is redacted", () => {
		logWarn("auth field test", { auth: "secret-auth-value" });
		const entry = lastLogEntry(`${stateDir}/log`);
		expect(JSON.stringify(entry.details)).not.toContain("secret-auth-value");
		expect(JSON.stringify(entry.details)).toContain("[REDACTED]");
	});

	test("{token: x} pattern — token value not in log", () => {
		const sensitiveToken = "x-sensitive-token-12345";
		logError(
			new AuthError("auth.token_cmd_failed", "fail", {
				details: { token: sensitiveToken },
			}),
		);
		const entries = canonicalLog(`${stateDir}/log`);
		const text = JSON.stringify(entries);
		expect(text).not.toContain(sensitiveToken);
	});

	test("{authorization: y} pattern — value not in log", () => {
		const sensitiveAuth = "y-auth-value-xyz";
		logInfo("test", { authorization: sensitiveAuth });
		const entries = canonicalLog(`${stateDir}/log`);
		const text = JSON.stringify(entries);
		expect(text).not.toContain(sensitiveAuth);
	});
});

describe("runSafely", () => {
	test("returns value on success", async () => {
		const result = await runSafely(async () => 42);
		expect(result).toBe(42);
	});

	test("catches PollerError and calls process.exit with correct code", async () => {
		const exitSpy = spyOn(process, "exit").mockImplementation((_code?: number) => {
			throw new Error("process.exit called");
		});
		try {
			await runSafely(async () => {
				throw new ConfigError("config.bad_env", "bad env");
			});
		} catch {
			// expected — we threw from mock
		}
		expect(exitSpy).toHaveBeenCalledWith(2);
		exitSpy.mockRestore();
	});

	test("catches bare Error and exits with code 1", async () => {
		const exitSpy = spyOn(process, "exit").mockImplementation((_code?: number) => {
			throw new Error("process.exit called");
		});
		try {
			await runSafely(async () => {
				throw new Error("bare error");
			});
		} catch {
			// expected
		}
		expect(exitSpy).toHaveBeenCalledWith(1);
		exitSpy.mockRestore();
	});

	test("runSafely logs the error to the log file before exiting", async () => {
		const exitSpy = spyOn(process, "exit").mockImplementation((_code?: number) => {
			throw new Error("process.exit called");
		});
		try {
			await runSafely(async () => {
				throw new DbError("db.open_failed", "db failed");
			});
		} catch {
			// expected
		}
		const entry = findLogEntry(`${stateDir}/log`, "db.open_failed");
		expect(entry.code).toBe("db.open_failed");
		exitSpy.mockRestore();
	});
});

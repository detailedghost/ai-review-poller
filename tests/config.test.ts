import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.ts";
import { ConfigError } from "../src/errors.ts";
import { mockEnv } from "./_helpers.ts";

describe("config — defaults", () => {
	test("returns default stateDir when env unset", () => {
		const cfg = loadConfig(mockEnv());
		expect(cfg.stateDir).toBe("/tmp/claude/review-loop-poller");
	});

	test("returns default binPath relative to HOME", () => {
		const cfg = loadConfig(mockEnv({ HOME: "/test-home" }));
		expect(cfg.binPath).toBe("/test-home/.local/bin/ai-review-poller");
	});

	test("returns empty srcDir when REVIEW_LOOP_POLLER_SRC unset", () => {
		const cfg = loadConfig(mockEnv({ HOME: "/test-home" }));
		expect(cfg.srcDir).toBe("");
	});

	test("returns default cadence */5 * * * *", () => {
		const cfg = loadConfig(mockEnv());
		expect(cfg.cadence).toBe("*/5 * * * *");
	});

	test("returns default staleMinutes 60", () => {
		const cfg = loadConfig(mockEnv());
		expect(cfg.staleMinutes).toBe(60);
	});

	test("returns default providerName github", () => {
		const cfg = loadConfig(mockEnv());
		expect(cfg.providerName).toBe("github");
	});

	test("pendingFile is stateDir/pending.json", () => {
		const cfg = loadConfig(mockEnv());
		expect(cfg.pendingFile).toBe("/tmp/claude/review-loop-poller/pending.json");
	});

	test("dbFile is stateDir/seen.db", () => {
		const cfg = loadConfig(mockEnv());
		expect(cfg.dbFile).toBe("/tmp/claude/review-loop-poller/seen.db");
	});

	test("logFile is stateDir/log", () => {
		const cfg = loadConfig(mockEnv());
		expect(cfg.logFile).toBe("/tmp/claude/review-loop-poller/log");
	});
});

describe("config — overrides", () => {
	test("REVIEW_LOOP_POLLER_STATE_DIR overrides stateDir", () => {
		const cfg = loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STATE_DIR: "/custom/state" }));
		expect(cfg.stateDir).toBe("/custom/state");
	});

	test("REVIEW_LOOP_POLLER_BIN overrides binPath", () => {
		const cfg = loadConfig(mockEnv({ REVIEW_LOOP_POLLER_BIN: "/custom/bin/poller" }));
		expect(cfg.binPath).toBe("/custom/bin/poller");
	});

	test("REVIEW_LOOP_POLLER_SRC overrides srcDir", () => {
		const cfg = loadConfig(mockEnv({ REVIEW_LOOP_POLLER_SRC: "/custom/src" }));
		expect(cfg.srcDir).toBe("/custom/src");
	});

	test("REVIEW_LOOP_POLLER_CADENCE overrides cadence", () => {
		const cfg = loadConfig(mockEnv({ REVIEW_LOOP_POLLER_CADENCE: "0 * * * *" }));
		expect(cfg.cadence).toBe("0 * * * *");
	});

	test("REVIEW_LOOP_POLLER_STALE_MIN overrides staleMinutes", () => {
		const cfg = loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STALE_MIN: "30" }));
		expect(cfg.staleMinutes).toBe(30);
	});

	test("REVIEW_LOOP_POLLER_PROVIDER overrides providerName", () => {
		const cfg = loadConfig(mockEnv({ REVIEW_LOOP_POLLER_PROVIDER: "gitlab" }));
		expect(cfg.providerName).toBe("gitlab");
	});

	test("pendingFile and dbFile reflect custom stateDir", () => {
		const cfg = loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STATE_DIR: "/my/state" }));
		expect(cfg.pendingFile).toBe("/my/state/pending.json");
		expect(cfg.dbFile).toBe("/my/state/seen.db");
		expect(cfg.logFile).toBe("/my/state/log");
	});
});

describe("config — validation: bad_env", () => {
	test("rejects path with .. in REVIEW_LOOP_POLLER_SRC", () => {
		expect(() => loadConfig(mockEnv({ REVIEW_LOOP_POLLER_SRC: "/home/../etc/evil" }))).toThrow(ConfigError);
	});

	test("rejects path with \\n in REVIEW_LOOP_POLLER_STATE_DIR", () => {
		expect(() => loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STATE_DIR: "/tmp/evil\npath" }))).toThrow(ConfigError);
	});

	test("rejects path with \\r in REVIEW_LOOP_POLLER_BIN", () => {
		expect(() => loadConfig(mockEnv({ REVIEW_LOOP_POLLER_BIN: "/bin/evil\rpath" }))).toThrow(ConfigError);
	});

	test("config.bad_env error has correct code", () => {
		let caught: unknown;
		try {
			loadConfig(mockEnv({ REVIEW_LOOP_POLLER_SRC: "/home/../evil" }));
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ConfigError);
		expect((caught as ConfigError).code).toBe("config.bad_env");
	});

	test("config.bad_env exit code is 2", () => {
		let caught: unknown;
		try {
			loadConfig(mockEnv({ REVIEW_LOOP_POLLER_SRC: "/home/../evil" }));
		} catch (e) {
			caught = e;
		}
		expect((caught as ConfigError).exitCode).toBe(2);
	});
});

describe("config — validation: bad_cadence", () => {
	test("rejects cadence with only 4 fields", () => {
		expect(() => loadConfig(mockEnv({ REVIEW_LOOP_POLLER_CADENCE: "*/5 * * *" }))).toThrow(ConfigError);
	});

	test("rejects empty cadence string", () => {
		expect(() => loadConfig(mockEnv({ REVIEW_LOOP_POLLER_CADENCE: "" }))).toThrow(ConfigError);
	});

	test("rejects cadence with 6 whitespace-separated fields", () => {
		// The regex requires exactly 5 fields (no leading/trailing space issues handled here)
		// A 6-field string would fail the CADENCE_RE which anchors start and end
		// Actually CADENCE_RE: /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/ — 6 fields would not match
		// because after the 5th field there would be a trailing space+field
		// This tests the regex boundary
		expect(() => loadConfig(mockEnv({ REVIEW_LOOP_POLLER_CADENCE: "* * * * * extra" }))).toThrow(ConfigError);
	});

	test("config.bad_cadence error has correct code", () => {
		let caught: unknown;
		try {
			loadConfig(mockEnv({ REVIEW_LOOP_POLLER_CADENCE: "bad" }));
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ConfigError);
		expect((caught as ConfigError).code).toBe("config.bad_cadence");
	});

	test("config.bad_cadence exit code is 2", () => {
		let caught: unknown;
		try {
			loadConfig(mockEnv({ REVIEW_LOOP_POLLER_CADENCE: "bad" }));
		} catch (e) {
			caught = e;
		}
		expect((caught as ConfigError).exitCode).toBe(2);
	});
});

describe("config — validation: bad_stale", () => {
	test("rejects non-numeric stale value", () => {
		expect(() => loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STALE_MIN: "not-a-number" }))).toThrow(ConfigError);
	});

	test("rejects zero stale value", () => {
		expect(() => loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STALE_MIN: "0" }))).toThrow(ConfigError);
	});

	test("rejects negative stale value", () => {
		expect(() => loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STALE_MIN: "-5" }))).toThrow(ConfigError);
	});

	test("rejects float stale value", () => {
		expect(() => loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STALE_MIN: "1.5" }))).toThrow(ConfigError);
	});

	test("config.bad_stale error has correct code", () => {
		let caught: unknown;
		try {
			loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STALE_MIN: "abc" }));
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ConfigError);
		expect((caught as ConfigError).code).toBe("config.bad_stale");
	});

	test("config.bad_stale exit code is 2", () => {
		let caught: unknown;
		try {
			loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STALE_MIN: "0" }));
		} catch (e) {
			caught = e;
		}
		expect((caught as ConfigError).exitCode).toBe(2);
	});

	test("accepts positive integer stale value", () => {
		const cfg = loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STALE_MIN: "1" }));
		expect(cfg.staleMinutes).toBe(1);
	});
});

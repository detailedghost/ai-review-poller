import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import {
	ApiError,
	AuthError,
	ConfigError,
	DbError,
	NetworkError,
	PrereqError,
	ProviderError,
	runSafely,
	StateError,
	setLogStateDir,
} from "../src/errors.ts";
import { openDb } from "../src/lib/db.ts";
import { runPoll } from "../src/poller.ts";
import { registry } from "../src/providers/index.ts";
import type { ReviewProvider } from "../src/providers/types.ts";
import { fakeProvider, findLogEntry, mockEnv, scratchStateDir } from "./_helpers.ts";

let stateDir: string;

beforeEach(() => {
	stateDir = scratchStateDir("errpaths");
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

/** Run fn via runSafely, intercepting process.exit. Returns the exit code. */
async function captureExit(fn: () => Promise<void>): Promise<number> {
	let exitCode = -1;
	const spy = spyOn(process, "exit").mockImplementation((code?: number) => {
		exitCode = code ?? 0;
		throw new Error("__process_exit__");
	});
	try {
		await runSafely(fn);
	} catch (e) {
		if (!(e instanceof Error) || e.message !== "__process_exit__") throw e;
	} finally {
		spy.mockRestore();
	}
	return exitCode;
}

// ---------------------------------------------------------------------------
// config.bad_env
// ---------------------------------------------------------------------------
describe("Error Catalog: config.bad_env", () => {
	test("env override with .. throws ConfigError config.bad_env exit 2", async () => {
		let caught: unknown;
		try {
			loadConfig(mockEnv({ REVIEW_LOOP_POLLER_SRC: "/home/../evil" }));
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ConfigError);
		expect((caught as ConfigError).code).toBe("config.bad_env");
		expect((caught as ConfigError).exitCode).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// config.bad_cadence
// ---------------------------------------------------------------------------
describe("Error Catalog: config.bad_cadence", () => {
	test("invalid cadence throws ConfigError config.bad_cadence exit 2", async () => {
		let caught: unknown;
		try {
			loadConfig(mockEnv({ REVIEW_LOOP_POLLER_CADENCE: "bad-value" }));
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ConfigError);
		expect((caught as ConfigError).code).toBe("config.bad_cadence");
		expect((caught as ConfigError).exitCode).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// config.bad_stale
// ---------------------------------------------------------------------------
describe("Error Catalog: config.bad_stale", () => {
	test("non-positive stale throws ConfigError config.bad_stale exit 2", async () => {
		let caught: unknown;
		try {
			loadConfig(mockEnv({ REVIEW_LOOP_POLLER_STALE_MIN: "0" }));
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ConfigError);
		expect((caught as ConfigError).code).toBe("config.bad_stale");
		expect((caught as ConfigError).exitCode).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// auth.token_cmd_failed
// ---------------------------------------------------------------------------
describe("Error Catalog: auth.token_cmd_failed", () => {
	test("provider getToken failure routes to AuthError auth.token_cmd_failed exit 1", async () => {
		const cfg = makeConfig(stateDir);
		const badTokenProvider: ReviewProvider = {
			name: "fake",
			botReviewerLogin: "copilot-pull-request-reviewer",
			async getToken() {
				throw new AuthError("auth.token_cmd_failed", "gh auth token failed", {
					details: { exitCode: 1, stderr: "error" },
				});
			},
			async fetchOpenPullRequests() {
				return [];
			},
		};
		let caught: unknown;
		await withFakeProvider(badTokenProvider, async () => {
			try {
				await runPoll(cfg);
			} catch (e) {
				caught = e;
			}
		});
		expect(caught).toBeInstanceOf(AuthError);
		expect((caught as AuthError).code).toBe("auth.token_cmd_failed");
		expect((caught as AuthError).exitCode).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// network.fetch_failed
// ---------------------------------------------------------------------------
describe("Error Catalog: network.fetch_failed", () => {
	test("fetch throw wraps to NetworkError network.fetch_failed exit 1", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			throw new Error("ENOTFOUND");
		}) as unknown as typeof fetch;
		let caught: unknown;
		try {
			await withFakeProvider(fakeProvider([]), async () => {
				// Use the real github provider to trigger fetch
				const { githubProvider } = await import("../src/providers/github.ts");
				await githubProvider.fetchOpenPullRequests("tok");
			});
		} catch (e) {
			caught = e;
		} finally {
			globalThis.fetch = originalFetch;
		}
		expect(caught).toBeInstanceOf(NetworkError);
		expect((caught as NetworkError).code).toBe("network.fetch_failed");
		expect((caught as NetworkError).exitCode).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// network.timeout
// ---------------------------------------------------------------------------
describe("Error Catalog: network.timeout", () => {
	test("AbortError from fetch throws NetworkError network.timeout exit 1", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			const e = new Error("aborted");
			e.name = "AbortError";
			throw e;
		}) as unknown as typeof fetch;
		let caught: unknown;
		try {
			const { githubProvider } = await import("../src/providers/github.ts");
			await githubProvider.fetchOpenPullRequests("tok");
		} catch (e) {
			caught = e;
		} finally {
			globalThis.fetch = originalFetch;
		}
		expect(caught).toBeInstanceOf(NetworkError);
		expect((caught as NetworkError).code).toBe("network.timeout");
		expect((caught as NetworkError).exitCode).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// api.http_status
// ---------------------------------------------------------------------------
describe("Error Catalog: api.http_status", () => {
	test("non-2xx response throws ApiError api.http_status exit 1", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => new Response("Forbidden", { status: 403 })) as unknown as typeof fetch;
		let caught: unknown;
		try {
			const { githubProvider } = await import("../src/providers/github.ts");
			await githubProvider.fetchOpenPullRequests("tok");
		} catch (e) {
			caught = e;
		} finally {
			globalThis.fetch = originalFetch;
		}
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).code).toBe("api.http_status");
		expect((caught as ApiError).exitCode).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// api.graphql_errors
// ---------------------------------------------------------------------------
describe("Error Catalog: api.graphql_errors", () => {
	test("errors[] payload throws ApiError api.graphql_errors exit 1", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ errors: [{ message: "unauthorized" }] }), {
				status: 200,
			})) as unknown as typeof fetch;
		let caught: unknown;
		try {
			const { githubProvider } = await import("../src/providers/github.ts");
			await githubProvider.fetchOpenPullRequests("tok");
		} catch (e) {
			caught = e;
		} finally {
			globalThis.fetch = originalFetch;
		}
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).code).toBe("api.graphql_errors");
		expect((caught as ApiError).exitCode).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// api.malformed_body
// ---------------------------------------------------------------------------
describe("Error Catalog: api.malformed_body", () => {
	test("non-JSON body throws ApiError api.malformed_body exit 1", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => new Response("not-json", { status: 200 })) as unknown as typeof fetch;
		let caught: unknown;
		try {
			const { githubProvider } = await import("../src/providers/github.ts");
			await githubProvider.fetchOpenPullRequests("tok");
		} catch (e) {
			caught = e;
		} finally {
			globalThis.fetch = originalFetch;
		}
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).code).toBe("api.malformed_body");
		expect((caught as ApiError).exitCode).toBe(1);
	});

	test("missing data.viewer.pullRequests throws ApiError api.malformed_body", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ data: {} }), { status: 200 })) as unknown as typeof fetch;
		let caught: unknown;
		try {
			const { githubProvider } = await import("../src/providers/github.ts");
			await githubProvider.fetchOpenPullRequests("tok");
		} catch (e) {
			caught = e;
		} finally {
			globalThis.fetch = originalFetch;
		}
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).code).toBe("api.malformed_body");
	});
});

// ---------------------------------------------------------------------------
// provider.unknown
// ---------------------------------------------------------------------------
describe("Error Catalog: provider.unknown", () => {
	test("resolve unknown provider throws ProviderError provider.unknown exit 2", async () => {
		const { resolve } = await import("../src/providers/index.ts");
		let caught: unknown;
		try {
			resolve("definitely-not-a-provider");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ProviderError);
		expect((caught as ProviderError).code).toBe("provider.unknown");
		expect((caught as ProviderError).exitCode).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// provider.token_unavailable (AuthError from getToken)
// ---------------------------------------------------------------------------
describe("Error Catalog: provider.token_unavailable", () => {
	test("getToken throwing AuthError propagates with exitCode 1", async () => {
		const badProvider: ReviewProvider = {
			name: "fake-bad",
			botReviewerLogin: "copilot-pull-request-reviewer",
			async getToken() {
				throw new AuthError("auth.token_cmd_failed", "token unavailable");
			},
			async fetchOpenPullRequests() {
				return [];
			},
		};
		let caught: unknown;
		try {
			await badProvider.getToken();
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(AuthError);
		expect((caught as AuthError).exitCode).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// db.open_failed
// ---------------------------------------------------------------------------
describe("Error Catalog: db.open_failed", () => {
	test("opening DB at unwritable path throws DbError db.open_failed exit 3", async () => {
		let caught: unknown;
		try {
			// Pass a path that can't be created (directory as file path)
			openDb("/dev/null/impossible/path/seen.db");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(DbError);
		expect((caught as DbError).code).toBe("db.open_failed");
		expect((caught as DbError).exitCode).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// db.schema_failed — hard to trigger cleanly; test the error class shape
// ---------------------------------------------------------------------------
describe("Error Catalog: db.schema_failed", () => {
	test("DbError with db.schema_failed has exitCode 3", () => {
		const e = new DbError("db.schema_failed", "schema error");
		expect(e.code).toBe("db.schema_failed");
		expect(e.exitCode).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// db.insert_failed
// ---------------------------------------------------------------------------
describe("Error Catalog: db.insert_failed", () => {
	test("DbError with db.insert_failed has exitCode 3", () => {
		const e = new DbError("db.insert_failed", "insert error");
		expect(e.code).toBe("db.insert_failed");
		expect(e.exitCode).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// state.tmp_write_failed
// ---------------------------------------------------------------------------
describe("Error Catalog: state.tmp_write_failed", () => {
	test("StateError state.tmp_write_failed has exitCode 3", () => {
		const e = new StateError("state.tmp_write_failed", "tmp write failed");
		expect(e.code).toBe("state.tmp_write_failed");
		expect(e.exitCode).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// state.rename_failed
// ---------------------------------------------------------------------------
describe("Error Catalog: state.rename_failed", () => {
	test("rename failure throws StateError state.rename_failed", async () => {
		const cfg = makeConfig(stateDir);
		const { writePending } = await import("../src/lib/pending.ts");
		const { mkdirSync, writeFileSync } = await import("node:fs");
		mkdirSync(cfg.pendingFile, { recursive: true });
		writeFileSync(`${cfg.pendingFile}/guard`, "block rename");

		let caught: unknown;
		try {
			await writePending(cfg, {
				count: 0,
				updatedAt: new Date().toISOString(),
				prs: [],
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(StateError);
		expect((caught as StateError).code).toBe("state.rename_failed");
		expect((caught as StateError).exitCode).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// state.malformed_pending
// ---------------------------------------------------------------------------
describe("Error Catalog: state.malformed_pending", () => {
	test("malformed pending.json throws StateError state.malformed_pending", async () => {
		const cfg = makeConfig(stateDir);
		writeFileSync(cfg.pendingFile, "{ not valid json", "utf8");
		const { readPending } = await import("../src/lib/pending.ts");
		let caught: unknown;
		try {
			await readPending(cfg);
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(StateError);
		expect((caught as StateError).code).toBe("state.malformed_pending");
		expect((caught as StateError).exitCode).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// state.mkdir_failed
// ---------------------------------------------------------------------------
describe("Error Catalog: state.mkdir_failed", () => {
	test("StateError state.mkdir_failed has exitCode 3", () => {
		const e = new StateError("state.mkdir_failed", "mkdir failed");
		expect(e.code).toBe("state.mkdir_failed");
		expect(e.exitCode).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// install.crontab_read_failed
// ---------------------------------------------------------------------------
describe("Error Catalog: install.crontab_read_failed", () => {
	test("PrereqError install.crontab_read_failed has exitCode 2", () => {
		const e = new PrereqError("install.crontab_read_failed", "crontab -l failed");
		expect(e.code).toBe("install.crontab_read_failed");
		expect(e.exitCode).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// install.crontab_write_failed
// ---------------------------------------------------------------------------
describe("Error Catalog: install.crontab_write_failed", () => {
	test("PrereqError install.crontab_write_failed has exitCode 2", () => {
		const e = new PrereqError("install.crontab_write_failed", "crontab - failed");
		expect(e.code).toBe("install.crontab_write_failed");
		expect(e.exitCode).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// install.skill_dir_exists
// ---------------------------------------------------------------------------
describe("Error Catalog: install.skill_dir_exists", () => {
	test("StateError install.skill_dir_exists has exitCode 2", () => {
		const e = new StateError("install.skill_dir_exists", "dir exists", {
			exitCode: 2,
		});
		expect(e.code).toBe("install.skill_dir_exists");
		expect(e.exitCode).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// install.skill_symlink_wrong
// ---------------------------------------------------------------------------
describe("Error Catalog: install.skill_symlink_wrong", () => {
	test("StateError install.skill_symlink_wrong has exitCode 2", () => {
		const e = new StateError("install.skill_symlink_wrong", "wrong symlink target", {
			exitCode: 2,
		});
		expect(e.code).toBe("install.skill_symlink_wrong");
		expect(e.exitCode).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// runtime.unexpected
// ---------------------------------------------------------------------------
describe("Error Catalog: runtime.unexpected", () => {
	test("bare Error thrown in runSafely produces exit 1 and runtime.unexpected log", async () => {
		setLogStateDir(stateDir);
		const exitCode = await captureExit(async () => {
			throw new Error("bare unexpected error");
		});
		expect(exitCode).toBe(1);
		const entry = findLogEntry(`${stateDir}/log`, "runtime.unexpected");
		expect(entry.code).toBe("runtime.unexpected");
	});
});

// ---------------------------------------------------------------------------
// prereq.missing_bun / missing_gh / missing_crontab / missing_git / gh_unauth
// ---------------------------------------------------------------------------
describe("Error Catalog: prereq errors", () => {
	test("PrereqError prereq.missing_bun has exitCode 2", () => {
		const e = new PrereqError("prereq.missing_bun", "bun missing");
		expect(e.code).toBe("prereq.missing_bun");
		expect(e.exitCode).toBe(2);
	});

	test("PrereqError prereq.missing_gh has exitCode 2", () => {
		const e = new PrereqError("prereq.missing_gh", "gh missing");
		expect(e.code).toBe("prereq.missing_gh");
		expect(e.exitCode).toBe(2);
	});

	test("PrereqError prereq.gh_unauth has exitCode 2", () => {
		const e = new PrereqError("prereq.gh_unauth", "gh not authenticated");
		expect(e.code).toBe("prereq.gh_unauth");
		expect(e.exitCode).toBe(2);
	});

	test("PrereqError prereq.missing_crontab has exitCode 2", () => {
		const e = new PrereqError("prereq.missing_crontab", "crontab missing");
		expect(e.code).toBe("prereq.missing_crontab");
		expect(e.exitCode).toBe(2);
	});

	test("PrereqError prereq.missing_git has exitCode 2", () => {
		const e = new PrereqError("prereq.missing_git", "git missing");
		expect(e.code).toBe("prereq.missing_git");
		expect(e.exitCode).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// runSafely logs error and exits with correct code (integration assertion)
// ---------------------------------------------------------------------------
describe("Error Catalog: runSafely routes all errors", () => {
	test("runSafely with DbError exits 3 and logs the error", async () => {
		setLogStateDir(stateDir);
		const exitCode = await captureExit(async () => {
			throw new DbError("db.open_failed", "db open failed");
		});
		expect(exitCode).toBe(3);
		const entry = findLogEntry(`${stateDir}/log`, "db.open_failed");
		expect(entry.level).toBe("error");
	});

	test("runSafely with ConfigError exits 2 and logs the error", async () => {
		setLogStateDir(stateDir);
		const exitCode = await captureExit(async () => {
			throw new ConfigError("config.bad_env", "bad env");
		});
		expect(exitCode).toBe(2);
		const entry = findLogEntry(`${stateDir}/log`, "config.bad_env");
		expect(entry.level).toBe("error");
	});
});

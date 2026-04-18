/**
 * Shared test helpers — not a test file; no tests run from this module.
 * Import from other test files via: import { scratchStateDir, mockEnv, fakeProvider, canonicalLog } from "./_helpers.ts";
 */

import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import type { LogEntry } from "../src/errors.ts";
import type { PullRequest, Review, ReviewProvider } from "../src/providers/types.ts";

// ---------------------------------------------------------------------------
// scratchStateDir
// ---------------------------------------------------------------------------

/**
 * Returns a unique, isolated state directory for a test.
 * Creates it with chmod 0700. Caller is responsible for cleanup (rm -rf).
 */
export function scratchStateDir(testName: string): string {
	const rand = Math.random().toString(36).slice(2, 6);
	const dir = `/tmp/claude/review-loop-poller-test-${testName}-${process.pid}-${rand}`;
	mkdirSync(dir, { recursive: true });
	chmodSync(dir, 0o700);
	return dir;
}

// ---------------------------------------------------------------------------
// mockEnv
// ---------------------------------------------------------------------------

const BASELINE_ENV: Record<string, string> = {
	HOME: process.env.HOME ?? "/tmp",
	PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
};

/**
 * Returns a minimal env Record with the given overrides applied on top.
 * Safe to pass to loadConfig() without relying on process.env.
 */
export function mockEnv(overrides: Record<string, string> = {}): Record<string, string> {
	return { ...BASELINE_ENV, ...overrides };
}

// ---------------------------------------------------------------------------
// fakeProvider
// ---------------------------------------------------------------------------

export interface FakePrInput {
	pr_url: string;
	review_id: number;
	submittedAt: string;
	authorLogin: string;
	title?: string;
	state?: string;
}

/**
 * Returns a ReviewProvider stub that yields canned pull requests.
 * All PRs are returned by fetchOpenPullRequests; filtering by botReviewerLogin
 * happens in the poller (not the provider), matching the real architecture.
 */
export function fakeProvider(reviews: FakePrInput[]): ReviewProvider {
	// Group reviews by pr_url
	const prMap = new Map<string, { title: string; reviews: Review[] }>();
	for (const r of reviews) {
		const key = r.pr_url;
		if (!prMap.has(key)) {
			prMap.set(key, { title: r.title ?? `PR at ${key}`, reviews: [] });
		}
		prMap.get(key)?.reviews.push({
			reviewId: r.review_id,
			submittedAt: r.submittedAt,
			authorLogin: r.authorLogin,
		});
	}

	const prs: PullRequest[] = Array.from(prMap.entries()).map(([url, data]) => ({
		url,
		title: data.title,
		reviews: data.reviews,
	}));

	return {
		name: "fake",
		botReviewerLogin: "copilot-pull-request-reviewer",
		async getToken(): Promise<string> {
			return "ghp_FAKE_TOKEN_FOR_TESTS";
		},
		async fetchOpenPullRequests(_token: string): Promise<PullRequest[]> {
			return prs;
		},
	};
}

// ---------------------------------------------------------------------------
// canonicalLog / lastLogEntry
// ---------------------------------------------------------------------------

/**
 * Reads a log file and returns all entries parsed as LogEntry objects.
 * Each line must be valid JSON — throws if a line fails to parse.
 */
export function canonicalLog(logPath: string): LogEntry[] {
	let text: string;
	try {
		text = readFileSync(logPath, "utf8");
	} catch {
		return [];
	}
	return text
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as LogEntry);
}

/**
 * Returns the last log entry written to the given log file.
 * Throws an assertion error (never undefined) — use this instead of entries[n]!
 * to avoid the noNonNullAssertion lint rule.
 */
export function lastLogEntry(logPath: string): LogEntry {
	const entries = canonicalLog(logPath);
	const last = entries.at(-1);
	if (last === undefined) throw new Error(`No log entries found in ${logPath}`);
	return last;
}

/**
 * Finds the first log entry matching the given code.
 * Throws if not found — use this for targeted log assertions.
 */
export function findLogEntry(logPath: string, code: string): LogEntry {
	const entries = canonicalLog(logPath);
	const found = entries.find((e) => e.code === code);
	if (found === undefined) throw new Error(`No log entry with code "${code}" in ${logPath}`);
	return found;
}

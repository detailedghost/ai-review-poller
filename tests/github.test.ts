import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { ApiError, NetworkError, setLogStateDir } from "../src/errors.ts";
import { githubProvider } from "../src/providers/github.ts";
import { scratchStateDir } from "./_helpers.ts";

let stateDir: string;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
	stateDir = scratchStateDir("github");
	setLogStateDir(stateDir);
	originalFetch = globalThis.fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	setLogStateDir("" as unknown as string);
	rmSync(stateDir, { recursive: true, force: true });
});

function mockFetch(body: unknown, status = 200) {
	globalThis.fetch = (async () =>
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		})) as unknown as typeof fetch;
}

describe("github provider — zero PRs", () => {
	test("zero PRs returns empty array", async () => {
		mockFetch({ data: { viewer: { pullRequests: { nodes: [] } } } });
		const prs = await githubProvider.fetchOpenPullRequests("tok");
		expect(prs).toEqual([]);
	});
});

describe("github provider — happy path", () => {
	test("one PR one Copilot review APPROVED returns 1 PR with 1 review", async () => {
		mockFetch({
			data: {
				viewer: {
					pullRequests: {
						nodes: [
							{
								url: "https://github.com/owner/repo/pull/1",
								title: "Test PR",
								reviews: {
									nodes: [
										{
											databaseId: 101,
											submittedAt: "2026-04-18T10:00:00Z",
											author: { login: "copilot-pull-request-reviewer" },
											state: "APPROVED",
										},
									],
								},
							},
						],
					},
				},
			},
		});
		const prs = await githubProvider.fetchOpenPullRequests("tok");
		expect(prs.length).toBe(1);
		expect(prs[0]?.reviews.length).toBe(1);
		expect(prs[0]?.reviews[0]?.authorLogin).toBe("copilot-pull-request-reviewer");
	});

	test("mixed authors (Copilot + human + bot) — provider returns ALL reviews unfiltered", async () => {
		mockFetch({
			data: {
				viewer: {
					pullRequests: {
						nodes: [
							{
								url: "https://github.com/owner/repo/pull/2",
								title: "Mixed PR",
								reviews: {
									nodes: [
										{
											databaseId: 201,
											submittedAt: "2026-04-18T10:00:00Z",
											author: { login: "copilot-pull-request-reviewer" },
											state: "APPROVED",
										},
										{
											databaseId: 202,
											submittedAt: "2026-04-18T10:01:00Z",
											author: { login: "human-user" },
											state: "APPROVED",
										},
										{
											databaseId: 203,
											submittedAt: "2026-04-18T10:02:00Z",
											author: { login: "some-bot" },
											state: "CHANGES_REQUESTED",
										},
									],
								},
							},
						],
					},
				},
			},
		});
		const prs = await githubProvider.fetchOpenPullRequests("tok");
		// Provider returns all reviews — filtering by botReviewerLogin is the poller's job
		expect(prs.length).toBe(1);
		expect(prs[0]?.reviews.length).toBe(3);
	});
});

describe("github provider — no-findings acks", () => {
	function mockFetchWithComments(comments: Array<Record<string, unknown>>) {
		mockFetch({
			data: {
				viewer: {
					pullRequests: {
						nodes: [
							{
								url: "https://github.com/owner/repo/pull/9",
								title: "Ack PR",
								reviews: { nodes: [] },
								comments: { nodes: comments },
							},
						],
					},
				},
			},
		});
	}

	test("copilot-swe-agent comment matching default pattern produces an ack", async () => {
		mockFetchWithComments([
			{
				databaseId: 4001,
				createdAt: "2026-04-21T15:00:12Z",
				body: "Reviewed this PR state at commit abc. No additional code changes were needed.",
				author: { login: "copilot-swe-agent" },
			},
		]);
		const prs = await githubProvider.fetchOpenPullRequests("tok");
		expect(prs[0]?.acks?.length).toBe(1);
		expect(prs[0]?.acks?.[0]?.commentId).toBe(4001);
		expect(prs[0]?.acks?.[0]?.authorLogin).toBe("copilot-swe-agent");
		expect(prs[0]?.acks?.[0]?.createdAt).toBe("2026-04-21T15:00:12Z");
	});

	test("comment body that does not match pattern is ignored", async () => {
		mockFetchWithComments([
			{
				databaseId: 4002,
				createdAt: "2026-04-21T15:00:12Z",
				body: "Reviewed. Found 3 issues — see inline comments.",
				author: { login: "copilot-swe-agent" },
			},
		]);
		const prs = await githubProvider.fetchOpenPullRequests("tok");
		expect(prs[0]?.acks?.length ?? 0).toBe(0);
	});

	test("matching comment from a non-bot author is ignored", async () => {
		mockFetchWithComments([
			{
				databaseId: 4003,
				createdAt: "2026-04-21T15:00:12Z",
				body: "No additional code changes were needed",
				author: { login: "detailedghost" },
			},
		]);
		const prs = await githubProvider.fetchOpenPullRequests("tok");
		expect(prs[0]?.acks?.length ?? 0).toBe(0);
	});

	test("custom noFindingsPattern overrides the default", async () => {
		mockFetchWithComments([
			{
				databaseId: 4004,
				createdAt: "2026-04-21T15:00:12Z",
				body: "LGTM — all clear",
				author: { login: "copilot-swe-agent" },
			},
		]);
		const prs = await githubProvider.fetchOpenPullRequests("tok", {
			noFindingsPattern: /lgtm/i,
		});
		expect(prs[0]?.acks?.length).toBe(1);
		expect(prs[0]?.acks?.[0]?.commentId).toBe(4004);
	});

	test("bodyExcerpt is capped at 240 chars", async () => {
		const long = "No additional code changes were needed. ".padEnd(500, "x");
		mockFetchWithComments([
			{
				databaseId: 4005,
				createdAt: "2026-04-21T15:00:12Z",
				body: long,
				author: { login: "copilot-swe-agent" },
			},
		]);
		const prs = await githubProvider.fetchOpenPullRequests("tok");
		expect(prs[0]?.acks?.[0]?.bodyExcerpt.length).toBe(240);
	});
});

describe("github provider — error paths", () => {
	test("malformed body (not JSON) throws ApiError api.malformed_body", async () => {
		globalThis.fetch = (async () => new Response("not-json", { status: 200 })) as unknown as typeof fetch;
		let caught: unknown;
		try {
			await githubProvider.fetchOpenPullRequests("tok");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).code).toBe("api.malformed_body");
	});

	test("errors[] payload throws ApiError api.graphql_errors", async () => {
		mockFetch({ errors: [{ message: "unauthorized" }] });
		let caught: unknown;
		try {
			await githubProvider.fetchOpenPullRequests("tok");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).code).toBe("api.graphql_errors");
	});

	test("non-2xx response throws ApiError api.http_status", async () => {
		mockFetch({ message: "Bad credentials" }, 401);
		let caught: unknown;
		try {
			await githubProvider.fetchOpenPullRequests("tok");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).code).toBe("api.http_status");
	});

	test("fetch throws (network down) throws NetworkError network.fetch_failed", async () => {
		globalThis.fetch = (async () => {
			throw new Error("ENOTFOUND");
		}) as unknown as typeof fetch;
		let caught: unknown;
		try {
			await githubProvider.fetchOpenPullRequests("tok");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(NetworkError);
		expect((caught as NetworkError).code).toBe("network.fetch_failed");
	});

	test("fetch AbortError (timeout) throws NetworkError network.timeout", async () => {
		globalThis.fetch = (async () => {
			const err = new Error("The operation was aborted");
			err.name = "AbortError";
			throw err;
		}) as unknown as typeof fetch;
		let caught: unknown;
		try {
			await githubProvider.fetchOpenPullRequests("tok");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(NetworkError);
		expect((caught as NetworkError).code).toBe("network.timeout");
	});

	test("missing data.viewer.pullRequests throws ApiError api.malformed_body", async () => {
		mockFetch({ data: {} });
		let caught: unknown;
		try {
			await githubProvider.fetchOpenPullRequests("tok");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ApiError);
		expect((caught as ApiError).code).toBe("api.malformed_body");
	});

	test("PR with invalid URL is skipped with logWarn (not crashed)", async () => {
		mockFetch({
			data: {
				viewer: {
					pullRequests: {
						nodes: [
							{
								url: "http://example.com/foo",
								title: "Bad URL PR",
								reviews: { nodes: [] },
							},
							{
								url: "https://github.com/owner/repo/pull/5",
								title: "Good PR",
								reviews: { nodes: [] },
							},
						],
					},
				},
			},
		});
		// Should not throw — invalid URL skipped with logWarn
		const prs = await githubProvider.fetchOpenPullRequests("tok");
		expect(prs.length).toBe(1);
		expect(prs[0]?.url).toBe("https://github.com/owner/repo/pull/5");
	});
});

import { describe, expect, test } from "bun:test";
import { ProviderError } from "../src/errors.ts";
import { githubProvider } from "../src/providers/github.ts";
import { registry, resolve } from "../src/providers/index.ts";

describe("provider registry — resolve()", () => {
	test("resolve() with no arg returns github provider", () => {
		const saved = process.env.REVIEW_LOOP_POLLER_PROVIDER;
		delete process.env.REVIEW_LOOP_POLLER_PROVIDER;
		const p = resolve();
		expect(p.name).toBe("github");
		if (saved !== undefined) process.env.REVIEW_LOOP_POLLER_PROVIDER = saved;
	});

	test("resolve('github') returns github provider", () => {
		const p = resolve("github");
		expect(p).toBe(githubProvider);
	});

	test("resolve('GITHUB') case-insensitive returns github provider", () => {
		const p = resolve("GITHUB");
		expect(p.name).toBe("github");
	});

	test("resolve('GITHUB') returns the same instance as resolve('github')", () => {
		expect(resolve("GITHUB")).toBe(resolve("github"));
	});

	test("resolve('unknown') throws ProviderError provider.unknown", () => {
		let caught: unknown;
		try {
			resolve("unknown-provider-xyz");
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(ProviderError);
		expect((caught as ProviderError).code).toBe("provider.unknown");
	});

	test("resolve('unknown') error message lists available providers", () => {
		let caught: unknown;
		try {
			resolve("notareal");
		} catch (e) {
			caught = e;
		}
		expect((caught as ProviderError).message).toContain("github");
	});

	test("registry contains github key", () => {
		expect(registry.github).toBeDefined();
	});
});

describe("provider contract shape", () => {
	test("githubProvider has name 'github'", () => {
		expect(githubProvider.name).toBe("github");
	});

	test("githubProvider has botReviewerLogin", () => {
		expect(githubProvider.botReviewerLogin).toBe("copilot-pull-request-reviewer");
	});

	test("githubProvider.getToken is a function", () => {
		expect(typeof githubProvider.getToken).toBe("function");
	});

	test("githubProvider.fetchOpenPullRequests is a function", () => {
		expect(typeof githubProvider.fetchOpenPullRequests).toBe("function");
	});
});

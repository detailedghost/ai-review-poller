import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");
const AGENTS_MD_PATH = join(REPO_ROOT, "AGENTS.md");

const REQUIRED_HEADINGS = [
	"## What this repo is",
	"## Install as an end user",
	"## Install for development",
	"## repo layout",
	"## How to add a provider",
	"## How to update the Claude Code skill",
	"## Testing and linting",
	"## Release process",
	"## Security checklist before merging",
	"## Contact",
];

describe("AGENTS.md — existence and structure", () => {
	test("AGENTS.md exists at repo root", () => {
		let exists = false;
		try {
			readFileSync(AGENTS_MD_PATH, "utf8");
			exists = true;
		} catch {
			exists = false;
		}
		expect(exists).toBe(true);
	});

	for (const heading of REQUIRED_HEADINGS) {
		test(`AGENTS.md contains required heading: "${heading}"`, () => {
			const content = readFileSync(AGENTS_MD_PATH, "utf8");
			expect(content).toContain(heading);
		});
	}

	test("AGENTS.md has all 10 required ## headings", () => {
		const content = readFileSync(AGENTS_MD_PATH, "utf8");
		const h2Headings = content.match(/^## .+/gm) ?? [];
		expect(h2Headings.length).toBeGreaterThanOrEqual(10);
	});

	test("AGENTS.md does not mention dtf-sync", () => {
		const content = readFileSync(AGENTS_MD_PATH, "utf8");
		expect(content).not.toContain("dtf-sync");
	});

	test("AGENTS.md does not contain personal username outside GitHub URLs", () => {
		const content = readFileSync(AGENTS_MD_PATH, "utf8");
		// Strip GitHub URLs (github.com, raw.githubusercontent.com) before checking —
		// repo URLs and install.sh raw URL are acceptable per spec.
		const stripped = content
			.replace(/https?:\/\/github\.com\/[^\s)]+/g, "")
			.replace(/https?:\/\/raw\.githubusercontent\.com\/[^\s)]+/g, "")
			.replace(/git@github\.com:[^\s]+/g, "");
		expect(stripped).not.toContain("detailedghost");
	});
});

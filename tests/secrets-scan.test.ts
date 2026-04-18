import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..");

const RG_EXCLUDE = [
	"--glob",
	"!.git/**",
	"--glob",
	"!node_modules/**",
	"--glob",
	"!coverage/**",
	"--glob",
	"!.vale/**",
	"--glob",
	"!bun.lock",
];

function rg(pattern: string): { found: boolean; output: string } {
	const result = Bun.spawnSync(["rg", "--no-heading", "-l", "-E", pattern, ...RG_EXCLUDE, REPO_ROOT]);
	return {
		found: result.exitCode === 0,
		output: new TextDecoder().decode(result.stdout).trim(),
	};
}

describe("secrets scan — no hardcoded credentials in repo", () => {
	test("no GitHub PAT (ghp_) in repo", () => {
		const { found, output } = rg("ghp_[A-Za-z0-9]{20,}");
		expect(found).toBe(false);
		if (found) console.error("Files with ghp_ tokens:", output);
	});

	test("no GitHub PAT (github_pat_) in repo", () => {
		const { found, output } = rg("github_pat_[A-Za-z0-9_]{20,}");
		expect(found).toBe(false);
		if (found) console.error("Files with github_pat_ tokens:", output);
	});

	test("no Google API key (AIza) in repo", () => {
		const { found, output } = rg("AIza[0-9A-Za-z_-]{35}");
		expect(found).toBe(false);
		if (found) console.error("Files with AIza keys:", output);
	});

	test("no AWS access key (AKIA) in repo", () => {
		const { found, output } = rg("AKIA[0-9A-Z]{16}");
		expect(found).toBe(false);
		if (found) console.error("Files with AKIA keys:", output);
	});

	test("no hardcoded /home/<username>/ paths in source or docs", () => {
		// This pattern checks for literal HOME-style paths.
		// README and AGENTS.md use $HOME which is fine.
		// The secrets-scan test itself references the pattern as a string literal — allowed.
		const { found, output } = rg("/home/[a-z0-9_-]+/");
		if (found) {
			// Filter out this test file itself (it contains the pattern as a string)
			const thisFile = "tests/secrets-scan.test.ts";
			const offendingFiles = output.split("\n").filter((line) => !line.includes(thisFile) && line.trim().length > 0);
			expect(offendingFiles.length).toBe(0);
			if (offendingFiles.length > 0) {
				console.error("Files with hardcoded /home/ paths:", offendingFiles.join("\n"));
			}
		}
	});
});

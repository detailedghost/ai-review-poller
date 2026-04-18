import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const SRC_ROOT = join(import.meta.dirname, "../src");

function rg(pattern: string, path: string, extraArgs: string[] = []): { exitCode: number; output: string } {
	const result = Bun.spawnSync(["rg", "--no-heading", "-n", ...extraArgs, pattern, path]);
	return {
		exitCode: result.exitCode ?? 1,
		output: new TextDecoder().decode(result.stdout).trim(),
	};
}

describe("discipline — no console.* outside errors.ts", () => {
	test("no console.log in src/ outside errors.ts", () => {
		// Exclude errors.ts from the search
		const result = rg("console\\.log", SRC_ROOT, ["--glob", "!errors.ts"]);
		expect(result.exitCode).toBe(1); // exit 1 = no matches = good
		if (result.exitCode === 0) {
			process.stderr.write(`console.log found in src/:\n${result.output}\n`);
		}
	});

	test("no console.error in src/ outside errors.ts", () => {
		const result = rg("console\\.error", SRC_ROOT, ["--glob", "!errors.ts"]);
		expect(result.exitCode).toBe(1);
	});

	test("no console.warn in src/ outside errors.ts", () => {
		const result = rg("console\\.warn", SRC_ROOT, ["--glob", "!errors.ts"]);
		expect(result.exitCode).toBe(1);
	});

	test("no console.info in src/ outside errors.ts", () => {
		const result = rg("console\\.info", SRC_ROOT, ["--glob", "!errors.ts"]);
		expect(result.exitCode).toBe(1);
	});
});

describe("discipline — no string-concatenated SQL in db.ts", () => {
	test("db.ts has no template literals with interpolation inside a db.run/query/exec call", () => {
		// Split the pattern to avoid biome's noTemplateCurlyInString rule firing on the
		// test source itself. The actual rg pattern is assembled at runtime.
		const dollarBrace = "\\$" + "\\{";
		const pattern = `db\\.(run|query|exec)\\s*\\(\\s*\`[^\`]*${dollarBrace}`;
		const result = rg(pattern, SRC_ROOT);
		expect(result.exitCode).toBe(1); // no matches = good
		if (result.exitCode === 0) {
			process.stderr.write(`Possible SQL string concatenation found:\n${result.output}\n`);
		}
	});

	test("db.ts uses named params $pr_url and $review_id", () => {
		const result = rg("\\$pr_url", join(SRC_ROOT, "lib/db.ts"));
		expect(result.exitCode).toBe(0); // exit 0 = found = good
	});

	test("db.ts uses named param $review_id", () => {
		const result = rg("\\$review_id", join(SRC_ROOT, "lib/db.ts"));
		expect(result.exitCode).toBe(0);
	});
});

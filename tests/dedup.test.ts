import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, statSync } from "node:fs";
import { openDb } from "../src/lib/db.ts";
import { scratchStateDir } from "./_helpers.ts";

let stateDir: string;
let dbPath: string;

beforeEach(() => {
	stateDir = scratchStateDir("dedup");
	dbPath = `${stateDir}/seen.db`;
});

afterEach(() => {
	rmSync(stateDir, { recursive: true, force: true });
});

describe("dedup — open and harden", () => {
	test("openDb creates the file", () => {
		using db = openDb(dbPath);
		expect(db).toBeDefined();
		expect(statSync(dbPath).isFile()).toBe(true);
	});

	test("DB file mode is 0600 after open", () => {
		using db = openDb(dbPath);
		expect(db).toBeDefined();
		const mode = statSync(dbPath).mode & 0o777;
		expect(mode).toBe(0o600);
	});
});

describe("dedup — insert and select", () => {
	test("insert one row then selectSeen returns it", () => {
		using db = openDb(dbPath);
		db.insertSeen.run({
			$pr_url: "https://github.com/a/b/pull/1",
			$review_id: 100,
			$seen_at: new Date().toISOString(),
		});
		const rows = db.selectSeen.all();
		expect(rows.length).toBe(1);
		expect(rows[0]?.pr_url).toBe("https://github.com/a/b/pull/1");
		expect(rows[0]?.review_id).toBe(100);
	});

	test("duplicate insert (same pr_url + review_id) is a no-op", () => {
		using db = openDb(dbPath);
		const params = {
			$pr_url: "https://github.com/a/b/pull/1",
			$review_id: 200,
			$seen_at: new Date().toISOString(),
		};
		db.insertSeen.run(params);
		db.insertSeen.run(params);
		const rows = db.selectSeen.all();
		expect(rows.length).toBe(1);
	});

	test("distinct review_ids on same pr_url both land", () => {
		using db = openDb(dbPath);
		const now = new Date().toISOString();
		db.insertSeen.run({ $pr_url: "https://github.com/a/b/pull/1", $review_id: 1, $seen_at: now });
		db.insertSeen.run({ $pr_url: "https://github.com/a/b/pull/1", $review_id: 2, $seen_at: now });
		const rows = db.selectSeen.all();
		expect(rows.length).toBe(2);
	});

	test("same review_id on different pr_urls both land", () => {
		using db = openDb(dbPath);
		const now = new Date().toISOString();
		db.insertSeen.run({ $pr_url: "https://github.com/a/b/pull/1", $review_id: 99, $seen_at: now });
		db.insertSeen.run({ $pr_url: "https://github.com/a/b/pull/2", $review_id: 99, $seen_at: now });
		const rows = db.selectSeen.all();
		expect(rows.length).toBe(2);
	});
});

describe("dedup — parameterized queries (no string concatenation)", () => {
	test("db.ts source has no raw string concatenation in SQL statements", () => {
		const src = readFileSync(new URL("../src/lib/db.ts", import.meta.url).pathname, "utf8");
		// Look for template literals with ${ inside a db.run() or db.query() call.
		// A legitimate SQL with ${} would be a security issue. The CREATE TABLE
		// statement uses a plain string literal (no interpolation), so this check
		// correctly whitelists it.
		const dangerPattern = /db\.(run|query|exec)\s*\(\s*`[^`]*\$\{/;
		expect(dangerPattern.test(src)).toBe(false);
	});

	test("INSERT statement uses named params ($pr_url, $review_id)", () => {
		const src = readFileSync(new URL("../src/lib/db.ts", import.meta.url).pathname, "utf8");
		expect(src).toContain("$pr_url");
		expect(src).toContain("$review_id");
	});
});

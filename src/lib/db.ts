import { Database, type Statement } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { DbError } from "../errors.ts";

export interface SeenRow {
	pr_url: string;
	review_id: number;
}

export type InsertSeenParams = {
	$pr_url: string;
	$review_id: number;
	$seen_at: string;
};

export interface DbHandle {
	selectSeen: Statement<SeenRow, []>;
	insertSeen: Statement<void, [Record<string, string | number | bigint | boolean | null>]>;
	transaction: Database["transaction"];
	[Symbol.dispose](): void;
}

export function openDb(path: string): DbHandle {
	let db: Database;
	try {
		db = new Database(path, { create: true });
	} catch (err) {
		throw new DbError("db.open_failed", `failed to open SQLite database at ${path}`, {
			details: { path },
			cause: err,
		});
	}

	try {
		chmodSync(path, 0o600);
	} catch {
		// best-effort; file may not exist on disk yet for in-memory DBs
	}

	try {
		db.run("PRAGMA journal_mode = WAL;");
		db.run("PRAGMA synchronous = NORMAL;");
		db.run(`
			CREATE TABLE IF NOT EXISTS seen_reviews (
				pr_url    TEXT    NOT NULL,
				review_id INTEGER NOT NULL,
				seen_at   TEXT    NOT NULL,
				PRIMARY KEY (pr_url, review_id)
			);
		`);
	} catch (err) {
		db.close();
		throw new DbError("db.schema_failed", "failed to initialize database schema", {
			cause: err,
		});
	}

	const selectSeen = db.query<{ pr_url: string; review_id: number }, []>("SELECT pr_url, review_id FROM seen_reviews;");

	const insertSeen = db.query<void, { $pr_url: string; $review_id: number; $seen_at: string }>(
		"INSERT OR IGNORE INTO seen_reviews (pr_url, review_id, seen_at) VALUES ($pr_url, $review_id, $seen_at);",
	);

	return {
		selectSeen,
		insertSeen,
		transaction: db.transaction.bind(db),
		[Symbol.dispose]() {
			db.close();
		},
	};
}

import { chmodSync, renameSync } from "node:fs";
import type { Config } from "../config.ts";
import { StateError } from "../errors.ts";

export interface PendingPr {
	url: string;
	title: string;
	reviewId: number;
	submittedAt: string;
}

export interface Pending {
	count: number;
	updatedAt: string;
	prs: PendingPr[];
	warnings?: string[];
}

export async function writePending(config: Config, payload: Pending): Promise<void> {
	const suffix = `${process.pid}.${Math.random().toString(36).slice(2, 10)}`;
	const tmp = `${config.pendingFile}.tmp.${suffix}`;
	const json = JSON.stringify(payload, null, 2);

	try {
		await Bun.write(tmp, json);
	} catch (err) {
		throw new StateError("state.tmp_write_failed", `failed to write temp file ${tmp}`, {
			details: { path: tmp },
			cause: err,
		});
	}

	try {
		chmodSync(tmp, 0o600);
	} catch {
		// best-effort
	}

	try {
		renameSync(tmp, config.pendingFile);
	} catch (err) {
		throw new StateError("state.rename_failed", `failed to rename ${tmp} to ${config.pendingFile}`, {
			details: { tmp, dest: config.pendingFile },
			cause: err,
		});
	}
}

export async function readPending(config: Config): Promise<Pending | null> {
	const file = Bun.file(config.pendingFile);
	const exists = await file.exists();
	if (!exists) return null;

	let text: string;
	try {
		text = await file.text();
	} catch (err) {
		throw new StateError("state.malformed_pending", `failed to read ${config.pendingFile}`, {
			details: { path: config.pendingFile },
			cause: err,
		});
	}

	try {
		return JSON.parse(text) as Pending;
	} catch (err) {
		throw new StateError("state.malformed_pending", `pending.json is not valid JSON at ${config.pendingFile}`, {
			details: { path: config.pendingFile, snippet: text.slice(0, 200) },
			cause: err,
		});
	}
}

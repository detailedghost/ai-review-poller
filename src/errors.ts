import { appendFileSync, renameSync, statSync } from "node:fs";

const LOG_MAX_BYTES = 5 * 1024 * 1024;

let _stateDir: string | null = null;

export function setLogStateDir(dir: string): void {
	_stateDir = dir;
}

function logFilePath(): string | null {
	if (_stateDir === null) return null;
	return `${_stateDir}/log`;
}

function redactValue(val: unknown): unknown {
	if (typeof val === "string") {
		return val.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
	}
	return val;
}

function redactDetails(details: Record<string, unknown>): Record<string, unknown> {
	const redacted: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(details)) {
		const lk = key.toLowerCase();
		if (lk === "token" || lk === "authorization" || lk === "auth") {
			redacted[key] = "[REDACTED]";
		} else {
			redacted[key] = redactValue(value);
		}
	}
	return redacted;
}

export interface LogEntry {
	ts: string;
	level: "info" | "warn" | "error";
	code?: string;
	message: string;
	details?: Record<string, unknown>;
}

function writeLogEntry(entry: LogEntry): void {
	const path = logFilePath();
	if (path === null) return;

	const line = `${JSON.stringify(entry)}\n`;

	try {
		let size = 0;
		try {
			size = statSync(path).size;
		} catch {
			// file doesn't exist yet — size stays 0
		}
		if (size >= LOG_MAX_BYTES) {
			try {
				renameSync(path, `${path}.1`);
			} catch {
				// best-effort rotation
			}
		}
		appendFileSync(path, line, { encoding: "utf8" });
	} catch {
		// never let logging errors crash the poller
	}
}

export function logInfo(msg: string, details?: Record<string, unknown>): void {
	const entry: LogEntry = {
		ts: new Date().toISOString(),
		level: "info",
		message: `ℹ️ ${msg}`,
		...(details !== undefined ? { details: redactDetails(details) } : {}),
	};
	writeLogEntry(entry);
	process.stderr.write(`${entry.message}\n`);
}

export function logWarn(msg: string, details?: Record<string, unknown>): void {
	const entry: LogEntry = {
		ts: new Date().toISOString(),
		level: "warn",
		message: `⚠️ ${msg}`,
		...(details !== undefined ? { details: redactDetails(details) } : {}),
	};
	writeLogEntry(entry);
	process.stderr.write(`${entry.message}\n`);
}

export function logError(err: unknown): void {
	const pollerErr = normalizeError(err);
	const entry: LogEntry = {
		ts: new Date().toISOString(),
		level: "error",
		code: pollerErr.code,
		message: `❌ ${pollerErr.code}: ${pollerErr.message}`,
		...(pollerErr.details !== undefined ? { details: redactDetails(pollerErr.details) } : {}),
	};
	writeLogEntry(entry);
	process.stderr.write(`${entry.message}\n`);
}

export class PollerError extends Error {
	readonly code: string;
	readonly exitCode: number;
	readonly details?: Record<string, unknown>;

	constructor(
		code: string,
		message: string,
		opts?: {
			exitCode?: number;
			details?: Record<string, unknown>;
			cause?: unknown;
		},
	) {
		super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
		this.name = this.constructor.name;
		this.code = code;
		this.exitCode = opts?.exitCode ?? 1;
		this.details = opts?.details;
	}
}

export class ConfigError extends PollerError {
	constructor(code: string, message: string, opts?: { details?: Record<string, unknown>; cause?: unknown }) {
		super(code, message, { exitCode: 2, ...opts });
	}
}

export class AuthError extends PollerError {
	constructor(code: string, message: string, opts?: { details?: Record<string, unknown>; cause?: unknown }) {
		super(code, message, { exitCode: 1, ...opts });
	}
}

export class NetworkError extends PollerError {
	constructor(code: string, message: string, opts?: { details?: Record<string, unknown>; cause?: unknown }) {
		super(code, message, { exitCode: 1, ...opts });
	}
}

export class ApiError extends PollerError {
	constructor(code: string, message: string, opts?: { details?: Record<string, unknown>; cause?: unknown }) {
		super(code, message, { exitCode: 1, ...opts });
	}
}

export class DbError extends PollerError {
	constructor(code: string, message: string, opts?: { details?: Record<string, unknown>; cause?: unknown }) {
		super(code, message, { exitCode: 3, ...opts });
	}
}

export class StateError extends PollerError {
	constructor(
		code: string,
		message: string,
		opts?: {
			exitCode?: number;
			details?: Record<string, unknown>;
			cause?: unknown;
		},
	) {
		super(code, message, { exitCode: opts?.exitCode ?? 3, ...opts });
	}
}

export class PrereqError extends PollerError {
	constructor(code: string, message: string, opts?: { details?: Record<string, unknown>; cause?: unknown }) {
		super(code, message, { exitCode: 2, ...opts });
	}
}

export class ProviderError extends PollerError {
	constructor(code: string, message: string, opts?: { details?: Record<string, unknown>; cause?: unknown }) {
		super(code, message, { exitCode: 2, ...opts });
	}
}

function normalizeError(err: unknown): PollerError {
	if (err instanceof PollerError) return err;
	if (err instanceof Error) {
		return new PollerError("runtime.unexpected", err.message, {
			exitCode: 1,
			details: { name: err.name, stack: err.stack },
			cause: err,
		});
	}
	return new PollerError("runtime.unexpected", String(err), { exitCode: 1 });
}

export async function runSafely<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		const pollerErr = normalizeError(err);
		logError(pollerErr);
		process.exit(pollerErr.exitCode);
	}
}

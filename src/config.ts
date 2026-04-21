import { ConfigError } from "./errors.ts";
import { DEFAULT_NO_FINDINGS_PATTERN } from "./providers/github.ts";

export function requireSrcDir(config: Config): string {
	if (!config.srcDir) {
		throw new ConfigError(
			"config.src_unset",
			"REVIEW_LOOP_POLLER_SRC is not set — invoke the binary via run.sh or export the variable to the source checkout path",
		);
	}
	return config.srcDir;
}

export interface Config {
	readonly srcDir: string;
	readonly stateDir: string;
	readonly binPath: string;
	readonly cadence: string;
	readonly staleMinutes: number;
	readonly providerName: string;
	readonly pendingFile: string;
	readonly dbFile: string;
	readonly logFile: string;
	readonly noFindingsPattern: RegExp;
}

const CADENCE_RE = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;
const PATH_BANNED_RE = /\.\.|[\n\r]/;

function validatePath(value: string, varName: string): void {
	if (PATH_BANNED_RE.test(value)) {
		throw new ConfigError("config.bad_env", `env var ${varName} contains invalid characters`, {
			details: { var: varName, value: "[REDACTED]" },
		});
	}
}

function env(record: Record<string, string | undefined>, key: string): string | undefined {
	return record[key];
}

export function loadConfig(envRecord: Record<string, string | undefined> = process.env): Config {
	const home = envRecord.HOME ?? "/tmp";

	const srcDir = env(envRecord, "REVIEW_LOOP_POLLER_SRC") ?? "";
	if (srcDir) validatePath(srcDir, "REVIEW_LOOP_POLLER_SRC");

	const stateDir = env(envRecord, "REVIEW_LOOP_POLLER_STATE_DIR") ?? "/tmp/claude/review-loop-poller";
	validatePath(stateDir, "REVIEW_LOOP_POLLER_STATE_DIR");

	const binPath = env(envRecord, "REVIEW_LOOP_POLLER_BIN") ?? `${home}/.local/bin/ai-review-poller`;
	validatePath(binPath, "REVIEW_LOOP_POLLER_BIN");

	const cadenceRaw = env(envRecord, "REVIEW_LOOP_POLLER_CADENCE") ?? "*/5 * * * *";
	if (!CADENCE_RE.test(cadenceRaw)) {
		throw new ConfigError("config.bad_cadence", `cadence "${cadenceRaw}" is not a valid 5-field cron expression`, {
			details: { cadence: cadenceRaw },
		});
	}

	const staleRaw = env(envRecord, "REVIEW_LOOP_POLLER_STALE_MIN") ?? "60";
	const staleMinutes = Number(staleRaw);
	if (!Number.isInteger(staleMinutes) || staleMinutes <= 0) {
		throw new ConfigError(
			"config.bad_stale",
			`REVIEW_LOOP_POLLER_STALE_MIN must be a positive integer, got "${staleRaw}"`,
			{ details: { value: staleRaw } },
		);
	}

	const providerName = env(envRecord, "REVIEW_LOOP_POLLER_PROVIDER") ?? "github";

	const patternRaw = env(envRecord, "REVIEW_LOOP_POLLER_NO_FINDINGS_PATTERN");
	let noFindingsPattern: RegExp;
	if (patternRaw === undefined || patternRaw === "") {
		noFindingsPattern = DEFAULT_NO_FINDINGS_PATTERN;
	} else {
		try {
			noFindingsPattern = new RegExp(patternRaw, "i");
		} catch (err) {
			throw new ConfigError(
				"config.bad_pattern",
				`REVIEW_LOOP_POLLER_NO_FINDINGS_PATTERN is not a valid regex: ${err instanceof Error ? err.message : String(err)}`,
				{ details: { pattern: patternRaw }, cause: err },
			);
		}
	}

	return {
		srcDir,
		stateDir,
		binPath,
		cadence: cadenceRaw,
		staleMinutes,
		providerName,
		pendingFile: `${stateDir}/pending.json`,
		dbFile: `${stateDir}/seen.db`,
		logFile: `${stateDir}/log`,
		noFindingsPattern,
	} satisfies Config;
}

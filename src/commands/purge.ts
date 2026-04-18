import { existsSync, rmSync } from "node:fs";
import type { Config } from "../config.ts";
import { logInfo } from "../errors.ts";
import { cmdUninstall } from "./uninstall.ts";

export async function cmdPurge(config: Config): Promise<void> {
	await cmdUninstall(config);

	if (existsSync(config.binPath)) {
		rmSync(config.binPath, { force: true });
		logInfo(`removed binary ${config.binPath}`);
	}

	logInfo("purged ✓");
}

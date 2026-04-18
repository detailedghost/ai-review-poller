import { cmdHelp } from "./commands/help.ts";
import { cmdInstall } from "./commands/install.ts";
import { cmdPurge } from "./commands/purge.ts";
import { cmdStatus } from "./commands/status.ts";
import { cmdUninstall } from "./commands/uninstall.ts";
import { cmdWhere } from "./commands/where.ts";
import { loadConfig } from "./config.ts";
import { runSafely } from "./errors.ts";
import { runPoll } from "./poller.ts";

type Action =
	| { type: "poll" }
	| { type: "install"; providerOverride?: string }
	| { type: "uninstall" }
	| { type: "purge" }
	| { type: "status" }
	| { type: "where" }
	| { type: "help" };

function parseArgv(argv: string[]): Action {
	let providerOverride: string | undefined;
	let action: Action | undefined;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--provider") {
			const next = argv[i + 1];
			if (next === undefined || next.startsWith("-")) {
				// Invalid: --provider with no value — fall through to help
				return { type: "help" };
			}
			providerOverride = next;
			i++; // consume the value
		} else if (arg === "--install") {
			action = { type: "install", providerOverride };
		} else if (arg === "--uninstall") {
			action = { type: "uninstall" };
		} else if (arg === "--purge") {
			action = { type: "purge" };
		} else if (arg === "--status") {
			action = { type: "status" };
		} else if (arg === "--where") {
			action = { type: "where" };
		} else if (arg === "--help" || arg === "-h") {
			action = { type: "help" };
		} else {
			// Unknown flag
			return { type: "help" };
		}
	}

	// --provider without an action flag is treated as: install with that provider
	if (providerOverride !== undefined && action === undefined) {
		return { type: "install", providerOverride };
	}

	// Attach providerOverride to install action if set after initial parse
	if (action?.type === "install" && providerOverride !== undefined) {
		action = { type: "install", providerOverride };
	}

	return action ?? { type: "poll" };
}

await runSafely(async () => {
	// argv starts at index 2 (node/bun, script path)
	const args = process.argv.slice(2);
	const action = parseArgv(args);

	const config = loadConfig(process.env);

	switch (action.type) {
		case "poll":
			await runPoll(config);
			break;
		case "install":
			await cmdInstall(config, { providerOverride: action.providerOverride });
			break;
		case "uninstall":
			await cmdUninstall(config);
			break;
		case "purge":
			await cmdPurge(config);
			break;
		case "status":
			await cmdStatus(config);
			break;
		case "where":
			await cmdWhere(config);
			break;
		case "help":
			await cmdHelp();
			break;
	}
});

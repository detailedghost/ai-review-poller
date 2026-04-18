import { ProviderError } from "../errors.ts";
import { githubProvider } from "./github.ts";
import type { ReviewProvider } from "./types.ts";

const registry: Record<string, ReviewProvider> = {
	github: githubProvider,
};

export function resolve(name?: string): ReviewProvider {
	const target = (name ?? process.env.REVIEW_LOOP_POLLER_PROVIDER ?? "github").toLowerCase();
	const provider = registry[target];
	if (provider === undefined) {
		const available = Object.keys(registry).join(", ");
		throw new ProviderError("provider.unknown", `unknown provider "${target}"; available: ${available}`, {
			details: { requested: target, available },
		});
	}
	return provider;
}

export { registry };

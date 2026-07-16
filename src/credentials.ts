/** Literal-only API key resolution. */

import type { SearchConfig } from "./types.js";

/**
 * Return the trimmed literal apiKey from config, or undefined.
 * No env-var refs, no !shell commands.
 */
export function resolveBackendKey(backend: string, config: SearchConfig): string | undefined {
	const key = config.backends?.[backend as keyof NonNullable<SearchConfig["backends"]>]?.apiKey;
	if (typeof key !== "string") return undefined;
	const trimmed = key.trim();
	if (!trimmed) return undefined;
	const lower = trimmed.toLowerCase();
	if (lower === "null" || lower === "undefined" || lower === "none") return undefined;
	return trimmed;
}

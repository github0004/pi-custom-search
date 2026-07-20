/** Shared types for pi-custom-search. */

export type BackendName = "brave" | "serper" | "tavily" | "exa" | "linkup";

export const BACKEND_NAMES: readonly BackendName[] = [
	"brave",
	"serper",
	"tavily",
	"exa",
	"linkup",
] as const;

export interface BackendConfig {
	enabled?: boolean;
	apiKey?: string;
	/** Per-backend timeout override in milliseconds. Default: 30000 */
	timeout?: number;
	/** Per-backend max results override. Default: 10 */
	maxResults?: number;
	/** Linkup-specific: search depth — "standard" (fast) or "deep". Default: standard */
	depth?: "standard" | "deep";
}

export type ReadMode = "auto" | "fast" | "fingerprint" | "readable" | "browser";
export type ReadFormat = "markdown" | "text" | "html";
/** Chat return shape: ranked excerpts (default) or full main-content body. */
export type ReadReturnMode = "excerpts" | "full";

export interface ReadConfig {
	defaultMode?: ReadMode;
	defaultFormat?: ReadFormat;
	/** Chat default when not saving. Default: excerpts. */
	defaultReturn?: ReadReturnMode;
	onlyMainContent?: boolean;
	removeImages?: boolean;
	maxChars?: number;
	/** Char budget for excerpt chat returns. Default: 6000. */
	excerptMaxChars?: number;
	/** Max download size in bytes (floored at 2MB; default 5MB). */
	maxBytes?: number;
	timeoutSeconds?: number;
	/**
	 * CloakBrowser visibility. Default true (no window).
	 * Set false to watch the browser while it renders the page.
	 */
	headless?: boolean;
}

export interface SearchConfig {
	/** Tool default when `backend` param omitted. `"auto"` = random shuffle. */
	defaultBackend?: BackendName | "auto";
	compact?: boolean;
	showStatus?: boolean;
	numResults?: number;
	read?: ReadConfig;
	backends?: {
		brave?: BackendConfig;
		serper?: BackendConfig;
		tavily?: BackendConfig;
		exa?: BackendConfig;
		linkup?: BackendConfig;
	};
}

export interface SearchResult {
	title: string;
	url: string;
	snippet?: string;
	content?: string;
}

export interface BackendRunner {
	label: string;
	search: (
		query: string,
		numResults: number,
		deps: {
			key?: string;
			signal?: AbortSignal;
			backendConfig?: BackendConfig;
		},
	) => Promise<{ results: SearchResult[] }>;
}

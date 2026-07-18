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

export interface ReadConfig {
	defaultMode?: ReadMode;
	defaultFormat?: ReadFormat;
	onlyMainContent?: boolean;
	removeImages?: boolean;
	maxChars?: number;
	/** Max download size in bytes (floored at 2MB; default 5MB). */
	maxBytes?: number;
	timeoutSeconds?: number;
	/**
	 * CloakBrowser visibility. Default true (no window).
	 * Set false to watch the browser while it renders the page.
	 */
	headless?: boolean;
}

/** Thresholds for context overload protection (see `src/context-safety.ts`). */
export interface ContextSafetyConfig {
	/** Master switch. Default: true */
	enabled?: boolean;
	/** Warn after this many search/read calls since last compact. Default: 2 */
	warnAfter?: number;
	/** Require pi-context management after this many calls. Default: 3 */
	manageAfter?: number;
	/** Soft-block further search/read until management. Default: 5 */
	blockAfter?: number;
	/** Warn when context usage % reaches this. Default: 45 */
	contextPercentWarn?: number;
	/** Require management when context usage % reaches this. Default: 60 */
	contextPercentManage?: number;
	/** Soft-block when context usage % reaches this. Default: 75 */
	contextPercentBlock?: number;
	/** Estimated chars of search/read output that trigger management. Default: 20000 */
	charsManage?: number;
}

export interface SearchConfig {
	/** Tool default when `backend` param omitted. `"auto"` = random shuffle. */
	defaultBackend?: BackendName | "auto";
	compact?: boolean;
	showStatus?: boolean;
	numResults?: number;
	read?: ReadConfig;
	/** Context overload guards; integrates with pi-context when installed. */
	contextSafety?: ContextSafetyConfig;
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

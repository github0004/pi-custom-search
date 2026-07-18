/**
 * Context overload safety for web_search / web_read.
 *
 * When pi-context is installed, steers the agent to checkpoint / timeline / compact
 * between noisy search/read bursts. Without it, falls back to aggressive result capping.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "./config.js";
import type { ContextSafetyConfig } from "./types.js";
import { getAgentDir } from "./utils.js";

const CONTEXT_TOOLS = [
	"context_checkpoint",
	"context_timeline",
	"context_compact",
] as const;

const SEARCH_TOOLS = new Set([
	"web_search",
	"web_read",
	"web_fetch",
	"web_fetch_and_index",
]);

export type SafetyLevel = "ok" | "warn" | "manage" | "block";
export type { ContextSafetyConfig };

export interface SafetyDecision {
	level: SafetyLevel;
	piContextAvailable: boolean;
	/** Append to tool result text (footer). */
	footer?: string;
	/** Prefer compact search formatting. */
	forceCompact: boolean;
	/** Cap numResults more tightly. */
	maxResultsCap?: number;
	/** Soft-block: return this instead of running the tool. */
	blockMessage?: string;
}

interface SessionCounters {
	searchesSinceCompact: number;
	readsSinceCompact: number;
	charsSinceCompact: number;
	opsSinceCompact: number;
	checkpointSeen: boolean;
	lastManageLevel: SafetyLevel;
}

let pi: {
	getActiveTools?: () => string[];
} | null = null;

let cachedPiContext: { available: boolean; checkedAt: number } | null = null;
const DETECT_TTL_MS = 30_000;

let session: SessionCounters = freshSession();

function freshSession(): SessionCounters {
	return {
		searchesSinceCompact: 0,
		readsSinceCompact: 0,
		charsSinceCompact: 0,
		opsSinceCompact: 0,
		checkpointSeen: false,
		lastManageLevel: "ok",
	};
}

function safetyConfig(): Required<ContextSafetyConfig> {
	const c = config.contextSafety ?? {};
	return {
		enabled: c.enabled !== false,
		// Tight defaults: the Noctalia/Reddit failure stacked ~5 searches + 2 large reads.
		warnAfter: c.warnAfter ?? 2,
		manageAfter: c.manageAfter ?? 3,
		blockAfter: c.blockAfter ?? 5,
		contextPercentWarn: c.contextPercentWarn ?? 45,
		contextPercentManage: c.contextPercentManage ?? 60,
		contextPercentBlock: c.contextPercentBlock ?? 75,
		charsManage: c.charsManage ?? 20_000,
	};
}

/**
 * Progressive chat return cap for web_read (chars). Shrinks as the burst grows
 * so a second browser-read cannot dump another full page into context.
 */
export function recommendedReadMaxChars(baseMax: number): number {
	const cfg = safetyConfig();
	if (!cfg.enabled) return baseMax;
	const ops = session.opsSinceCompact;
	let cap = baseMax;
	if (ops >= cfg.blockAfter || session.charsSinceCompact >= cfg.charsManage) {
		cap = Math.min(cap, 3_000);
	} else if (ops >= cfg.manageAfter) {
		cap = Math.min(cap, 5_000);
	} else if (ops >= cfg.warnAfter) {
		cap = Math.min(cap, 8_000);
	} else if (ops >= 1) {
		cap = Math.min(cap, 12_000);
	}
	return Math.max(1_500, cap);
}

/** Bind the ExtensionAPI so we can detect active pi-context tools. */
export function bindContextSafetyApi(api: { getActiveTools?: () => string[] }): void {
	pi = api;
	cachedPiContext = null;
}

export function resetContextSafetySession(): void {
	session = freshSession();
	cachedPiContext = null;
}

/** Call when pi-context compacted (or session_compact). */
export function noteContextCompacted(): void {
	session.searchesSinceCompact = 0;
	session.readsSinceCompact = 0;
	session.charsSinceCompact = 0;
	session.opsSinceCompact = 0;
	session.checkpointSeen = false;
	session.lastManageLevel = "ok";
}

/** Call when context_checkpoint succeeds. */
export function noteContextCheckpoint(): void {
	session.checkpointSeen = true;
}

function packagesListHasPiContext(): boolean {
	const paths = [
		join(getAgentDir(), "settings.json"),
		join(process.cwd(), ".pi", "settings.json"),
	];
	for (const path of paths) {
		if (!existsSync(path)) continue;
		try {
			const raw = JSON.parse(readFileSync(path, "utf-8")) as {
				packages?: string[];
			};
			const pkgs = raw.packages ?? [];
			if (
				pkgs.some(
					(p) =>
						p === "npm:pi-context" ||
						p === "pi-context" ||
						p.endsWith("/pi-context") ||
						/(^|[/:])pi-context(@|$)/.test(p),
				)
			) {
				return true;
			}
		} catch {
			// ignore
		}
	}
	return false;
}

function nodeModulesHasPiContext(): boolean {
	return existsSync(join(getAgentDir(), "npm", "node_modules", "pi-context"));
}

/**
 * True when pi-context tools are active, or the package is installed/listed.
 * Prefer active tools (actually loaded this session).
 */
export function isPiContextAvailable(force = false): boolean {
	const now = Date.now();
	if (!force && cachedPiContext && now - cachedPiContext.checkedAt < DETECT_TTL_MS) {
		return cachedPiContext.available;
	}

	let available = false;
	try {
		const tools = pi?.getActiveTools?.() ?? [];
		if (tools.some((t) => (CONTEXT_TOOLS as readonly string[]).includes(t))) {
			available = true;
		}
	} catch {
		// ignore
	}

	if (!available) {
		available = packagesListHasPiContext() || nodeModulesHasPiContext();
	}

	cachedPiContext = { available, checkedAt: now };
	return available;
}

export function isSearchTool(name: string): boolean {
	return SEARCH_TOOLS.has(name);
}

export function isContextTool(name: string): boolean {
	return (CONTEXT_TOOLS as readonly string[]).includes(name);
}

function contextPercent(
	ctx?: { getContextUsage?: () => { percent: number | null } | undefined },
): number | null {
	try {
		const usage = ctx?.getContextUsage?.();
		return usage?.percent ?? null;
	} catch {
		return null;
	}
}

function evaluateLevel(
	cfg: Required<ContextSafetyConfig>,
	percent: number | null,
): SafetyLevel {
	if (
		session.opsSinceCompact >= cfg.blockAfter ||
		(percent != null && percent >= cfg.contextPercentBlock)
	) {
		return "block";
	}
	if (
		session.opsSinceCompact >= cfg.manageAfter ||
		session.charsSinceCompact >= cfg.charsManage ||
		(percent != null && percent >= cfg.contextPercentManage)
	) {
		return "manage";
	}
	if (
		session.opsSinceCompact >= cfg.warnAfter ||
		(percent != null && percent >= cfg.contextPercentWarn)
	) {
		return "warn";
	}
	return "ok";
}

function footerFor(
	level: SafetyLevel,
	piCtx: boolean,
	percent: number | null,
	kind: "search" | "read",
): string | undefined {
	const pct = percent != null ? ` Context ~${percent.toFixed(0)}%.` : "";
	const ops = `${session.opsSinceCompact} search/read ops since last compact (${session.searchesSinceCompact} search, ${session.readsSinceCompact} read).`;

	if (!piCtx) {
		if (level === "ok") return undefined;
		return [
			"",
			"---",
			`[context-safety] ${ops}${pct}`,
			"pi-context is not installed. Install with: pi install npm:pi-context",
			"Until then: prefer compact=true, fewer numResults, and web_read saveDir for multi-page scrapes.",
			"See https://pi.dev/packages/pi-context",
		].join("\n");
	}

	if (level === "ok") {
		if (session.opsSinceCompact === 1 && !session.checkpointSeen) {
			return [
				"",
				"---",
				"[context-safety] pi-context detected. Before a larger search/read loop, call:",
				'  context_checkpoint({ name: "<task>-search-start" })',
				"After a stable finding, compact before the next phase (see context-management skill).",
			].join("\n");
		}
		return undefined;
	}

	if (level === "warn") {
		return [
			"",
			"---",
			`[context-safety:warn] ${ops}${pct}`,
			"Pause further web_* calls if the investigation already has a usable finding.",
			session.checkpointSeen
				? "When ready for the next phase: context_timeline → context_compact to your search checkpoint."
				: 'Create an anchor now: context_checkpoint({ name: "<task>-search-start" }), then continue sparingly.',
		].join("\n");
	}

	// manage / block share the same management recipe; block also has blockMessage
	const action =
		kind === "search"
			? "Do not issue another web_search until you manage context."
			: "Do not issue another web_read until you manage context (or use saveDir for vault scrapes).";

	return [
		"",
		"---",
		`[context-safety:${level}] ${ops}${pct}`,
		action,
		"Required (pi-context):",
		session.checkpointSeen
			? "  1. context_timeline() — pick the best compact target"
			: '  1. context_checkpoint({ name: "<task>-search-start" }) if you lack an anchor',
		session.checkpointSeen
			? '  2. context_compact({ target: "<checkpoint>", backupCheckpoint: "<task>-search-raw", summary: "..." })'
			: '  2. context_timeline() then context_compact({ target: "<checkpoint-or-root>", summary: "..." })',
		"Summary must restore: finding, source URLs, rejected leads, next step.",
	].join("\n");
}

export interface PrepareSafetyOpts {
	kind: "search" | "read";
	/** Approximate chars about to be / just returned. */
	resultChars?: number;
	ctx?: {
		getContextUsage?: () => { percent: number | null } | undefined;
	};
	/** When true, only evaluate (e.g. pre-flight block check) without bumping counters. */
	preview?: boolean;
}

/**
 * Pre-flight: decide whether to soft-block before running a search/read.
 * Does not mutate counters.
 */
export function preflightSafety(opts: PrepareSafetyOpts): SafetyDecision {
	const cfg = safetyConfig();
	const piCtx = isPiContextAvailable();
	if (!cfg.enabled) {
		return { level: "ok", piContextAvailable: piCtx, forceCompact: false };
	}

	const percent = contextPercent(opts.ctx);
	// Evaluate as if this op already counted (next op)
	const saved = session.opsSinceCompact;
	session.opsSinceCompact = saved + 1;
	const level = evaluateLevel(cfg, percent);
	session.opsSinceCompact = saved;

	const forceCompact =
		level === "manage" || level === "block" || (!piCtx && level !== "ok");
	const maxResultsCap =
		level === "block" ? 3 : level === "manage" ? 5 : level === "warn" ? 7 : undefined;

	// Soft-block when pi-context is available OR when char budget is already blown
	// (even without pi-context — agent must stop stuffing pages into chat).
	const shouldBlock =
		level === "block" &&
		(piCtx || session.charsSinceCompact >= cfg.charsManage || opts.kind === "read");

	if (shouldBlock) {
		return {
			level,
			piContextAvailable: piCtx,
			forceCompact: true,
			maxResultsCap: 3,
			blockMessage: [
				`Blocked: context overload risk (${saved} search/read ops since last compact` +
					`, ~${session.charsSinceCompact} chars returned` +
					(percent != null ? `, context ~${percent.toFixed(0)}%` : "") +
					").",
				piCtx
					? "pi-context is installed — manage conversation history before more web_* calls:"
					: "Install pi-context (pi install npm:pi-context) or stop stacking web_* into chat:",
				piCtx
					? session.checkpointSeen
						? "  context_timeline() then context_compact({ target, summary })"
						: '  context_checkpoint({ name: "<task>-search-start" }) then continue, or compact if you already have a finding'
					: "  Prefer compact=true, small numResults, web_read saveDir — do not load full pages into chat.",
				"After a successful context_compact, search/read limits reset.",
				"Escape hatch for one critical call only: pass force=true (still prefer compact / saveDir).",
			].join("\n"),
			footer: footerFor(level, piCtx, percent, opts.kind),
		};
	}

	return {
		level,
		piContextAvailable: piCtx,
		forceCompact,
		maxResultsCap,
		footer: footerFor(level, piCtx, percent, opts.kind),
	};
}

/**
 * Record a completed search/read and return footer / formatting advice for the result.
 */
export function recordSearchOp(opts: PrepareSafetyOpts): SafetyDecision {
	const cfg = safetyConfig();
	const piCtx = isPiContextAvailable();
	if (!cfg.enabled) {
		return { level: "ok", piContextAvailable: piCtx, forceCompact: false };
	}

	if (opts.kind === "search") session.searchesSinceCompact += 1;
	else session.readsSinceCompact += 1;
	session.opsSinceCompact += 1;
	session.charsSinceCompact += Math.max(0, opts.resultChars ?? 0);

	const percent = contextPercent(opts.ctx);
	const level = evaluateLevel(cfg, percent);
	session.lastManageLevel = level;

	const forceCompact =
		level === "manage" || level === "block" || (!piCtx && level !== "ok");
	const maxResultsCap =
		level === "block" ? 3 : level === "manage" ? 5 : level === "warn" ? 7 : undefined;

	// Large single payloads (FAQ/browser pages) escalate the footer even on early ops.
	let footer = footerFor(level, piCtx, percent, opts.kind);
	if (
		piCtx &&
		opts.kind === "read" &&
		(opts.resultChars ?? 0) >= 8_000 &&
		level === "ok"
	) {
		footer = [
			"",
			"---",
			"[context-safety] Large page returned. Extract the needed fact now, then context_checkpoint / context_compact before another web_read.",
			"Do not load more full pages into chat — use saveDir for vault scrapes.",
		].join("\n");
	}

	return {
		level,
		piContextAvailable: piCtx,
		forceCompact,
		maxResultsCap,
		footer,
	};
}

/**
 * Guidelines for web_* tools. Wording stays valid whether or not pi-context
 * was already registered when this package loaded.
 */
export function contextSafetyGuidelines(): string[] {
	return [
		"Avoid flooding context: prefer compact=true while exploring, keep numResults modest, and use web_read saveDir/savePath for multi-page scrapes",
		"If context_checkpoint / context_timeline / context_compact are available (pi-context): checkpoint before a search/read loop, then timeline+compact after a stable finding before the next phase",
		"Obey [context-safety] footers on web_* results — when they say manage or block, call the pi-context tools before more searches/reads (install: pi install npm:pi-context)",
	];
}

export function getSessionCounters(): Readonly<SessionCounters> {
	return session;
}

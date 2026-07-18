/** web_search tool registration. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import type { BackendName } from "../types.js";
import { config, refreshConfig, getActiveBackends } from "../config.js";
import {
	contextSafetyGuidelines,
	preflightSafety,
	recordSearchOp,
} from "../context-safety.js";
import { BACKEND_DEFS, runBackend } from "./backends/registry.js";
import { formatResults, formatResultsCompact } from "./formatters.js";

function shuffle<T>(items: T[]): T[] {
	const order = [...items];
	for (let i = order.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[order[i], order[j]] = [order[j], order[i]];
	}
	return order;
}

function isAbortError(err: unknown): boolean {
	return (
		(err instanceof Error && err.name === "AbortError") ||
		(typeof DOMException !== "undefined" &&
			err instanceof DOMException &&
			err.name === "AbortError")
	);
}

function withFooter(text: string, footer?: string): string {
	return footer ? `${text}${footer}` : text;
}

export function registerWebSearch(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web using brave, serper, tavily, exa, and/or linkup. " +
			"Auto mode picks a random enabled backend (with shuffled fallback on failure). " +
			"Use for fact-finding, research, documentation lookups, and current events. " +
			"For multi-query research, manage context with pi-context (checkpoint → search → compact) so results do not overflow the window.",
		promptSnippet: "Search the web (brave / serper / tavily / exa / linkup)",
		promptGuidelines: [
			"Use web_search when you need up-to-date information, facts, or documentation from the web",
			"Auto mode picks a random enabled backend; on failure it tries the others in random order",
			"Configure backends in ~/.pi/agent/extensions/search.json or .pi/search.json",
			...contextSafetyGuidelines(),
		],
		parameters: Type.Object({
			query: Type.String({
				description: "Search query (natural language works best)",
			}),
			numResults: Type.Optional(
				Type.Number({
					description: "Number of results (1-20, default from config or 10)",
					default: 10,
				}),
			),
			backend: Type.Optional(
				StringEnum(["brave", "serper", "tavily", "exa", "linkup", "auto"] as const, {
					description:
						"Backend to use. 'auto' picks a random configured backend (default)",
				}),
			),
			compact: Type.Optional(
				Type.Boolean({
					description:
						"When true, returns compact single-line results (title + URL). Default: false.",
					default: false,
				}),
			),
			force: Type.Optional(
				Type.Boolean({
					description:
						"Bypass context-safety soft-block for one critical call. Still applies compact caps and management footers. Prefer pi-context compact instead.",
					default: false,
				}),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			refreshConfig(ctx.cwd);

			const preflight = preflightSafety({ kind: "search", ctx });
			if (preflight.blockMessage && !params.force) {
				ctx.ui.setStatus("search", "⚠ context-safety: manage first");
				return {
					content: [{ type: "text", text: preflight.blockMessage }],
					details: {
						blocked: true,
						safetyLevel: preflight.level,
						piContextAvailable: preflight.piContextAvailable,
					},
				};
			}

			const defaultNum = config.numResults ?? 10;
			let numResults = Math.max(1, Math.min(params.numResults ?? defaultNum, 20));
			if (preflight.maxResultsCap != null) {
				numResults = Math.min(numResults, preflight.maxResultsCap);
			}
			const requestedBackend = params.backend || config.defaultBackend || "auto";
			const compact =
				Boolean(params.compact ?? config.compact) || preflight.forceCompact;

			const setStatus = (status: string) => {
				ctx.ui.setStatus("search", status);
				onUpdate?.({ content: [{ type: "text", text: `*${status}*` }] });
			};

			const finish = (text: string, details: Record<string, unknown>) => {
				const safety = recordSearchOp({
					kind: "search",
					resultChars: text.length,
					ctx,
				});
				return {
					content: [{ type: "text", text: withFooter(text, safety.footer) }],
					details: {
						...details,
						safetyLevel: safety.level,
						piContextAvailable: safety.piContextAvailable,
						forcedCompact: compact && (params.compact ?? config.compact) !== true,
					},
				};
			};

			if (requestedBackend !== "auto") {
				const pinned = requestedBackend as BackendName;
				const backendLabel = BACKEND_DEFS[pinned]?.label || pinned;
				setStatus(`🔍 ${backendLabel}: searching...`);
				try {
					const results = await runBackend(pinned, params.query, numResults, signal);
					setStatus(`🔍 ${backendLabel}: ${results.length} results`);
					const text = compact
						? formatResultsCompact(results)
						: formatResults(params.query, pinned, results);
					return finish(text, { backend: pinned, resultCount: results.length });
				} catch (err) {
					setStatus(`❌ ${backendLabel}: failed`);
					throw err;
				}
			}

			const activeBackends = getActiveBackends();
			if (activeBackends.length === 0) {
				throw new Error(
					"No search backends enabled with apiKey. Enable at least one in ~/.pi/agent/extensions/search.json",
				);
			}

			const orderedBackends = shuffle(activeBackends) as BackendName[];
			const errors: string[] = [];
			const primary = orderedBackends[0];
			for (const backend of orderedBackends) {
				if (signal?.aborted) {
					throw signal.reason instanceof Error
						? signal.reason
						: new DOMException("Aborted", "AbortError");
				}
				const backendLabel = BACKEND_DEFS[backend].label;
				const hint = backend === primary ? " (auto)" : " (auto fallback)";
				setStatus(`🔍 ${backendLabel}${hint}: searching...`);
				try {
					const results = await runBackend(backend, params.query, numResults, signal);
					if (results.length === 0) {
						errors.push(`${backend}: 0 results`);
						setStatus(`🔍 ${backendLabel}: empty, trying next...`);
						continue;
					}
					setStatus(`🔍 ${backendLabel}: ${results.length} results`);
					const usedFallback = errors.length > 0;
					const modeTag = usedFallback
						? `${backend} (auto fallback)`
						: `${backend} (auto)`;
					const body = compact
						? formatResultsCompact(results)
						: formatResults(params.query, backend, results);
					const text =
						errors.length > 0 ? `${errors.join("; ")}\n\n${body}` : body;
					return finish(text, {
						backend: modeTag,
						resultCount: results.length,
						errors: errors.length > 0 ? errors : undefined,
					});
				} catch (err) {
					if (signal?.aborted || isAbortError(err)) throw err;
					errors.push(`${backend}: ${(err as Error).message}`);
					setStatus(`❌ ${backendLabel}: failed, trying next...`);
				}
			}

			setStatus(`❌ all backends failed`);
			throw new Error(`All backends failed: ${errors.join("; ")}`);
		},
	});
}

/** web_search tool registration. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import type { SearchResultWithBackend } from "../types.js";
import { config, refreshConfig, getActiveBackends } from "../config.js";
import { BACKEND_DEFS, runBackend } from "./backends/registry.js";
import {
	selectBackendsForFallback,
	selectBackendsForRotate,
	reciprocalRankFusion,
	runTargetedCombine,
} from "./dispatch.js";
import {
	formatResults,
	formatCombinedResults,
	formatResultsCompact,
	formatCombinedResultsCompact,
} from "./formatters.js";

export function registerWebSearch(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web using brave, serper, tavily, exa, and/or linkup. " +
			"Auto mode uses fallback, round-robin rotate, or RRF combine based on search.json. " +
			"Use for fact-finding, research, documentation lookups, and current events.",
		promptSnippet: "Search the web (brave / serper / tavily / exa / linkup)",
		promptGuidelines: [
			"Use web_search when you need up-to-date information, facts, or documentation from the web",
			"Auto mode: fallback, rotate (round-robin), or RRF combine — controlled by search.json combineMode",
			"Set combine=true to query enabled backends in parallel and merge/deduplicate results",
			"Configure backends in ~/.pi/agent/extensions/search.json or .pi/search.json",
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
					description: "Backend to use. 'auto' picks from configured backends (default)",
				}),
			),
			combine: Type.Optional(
				Type.Boolean({
					description:
						"When true, queries enabled backends in parallel and merges/deduplicates results. " +
						"Config combineMode controls all vs targeted fan-out (ignored when combineMode is rotate). " +
						"Ignored when a specific backend is requested.",
					default: false,
				}),
			),
			compact: Type.Optional(
				Type.Boolean({
					description:
						"When true, returns compact single-line results (title + URL). Default: false.",
					default: false,
				}),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			refreshConfig(ctx.cwd);
			const defaultNum = config.numResults ?? 10;
			const numResults = Math.max(1, Math.min(params.numResults ?? defaultNum, 20));
			const requestedBackend = params.backend || "auto";
			const combine = params.combine ?? false;
			const compact = params.compact ?? config.compact ?? false;
			const combineMode = (() => {
				const raw = config.combineMode;
				if (raw === "all" || raw === "targeted" || raw === "rotate") return raw;
				if (raw !== undefined) {
					console.warn(
						`pi-custom-search: unrecognized combineMode "${raw}", falling back to "all"`,
					);
				}
				return "all";
			})();
			const forceCombine = config.combine === true;
			// rotate is mutually exclusive with combine fan-out
			const effectiveCombine =
				combineMode !== "rotate" && (forceCombine || combine);

			const setStatus = (status: string) => {
				ctx.ui.setStatus("search", status);
				onUpdate?.({ content: [{ type: "text", text: `*${status}*` }] });
			};

			if (requestedBackend !== "auto") {
				const backendLabel = BACKEND_DEFS[requestedBackend]?.label || requestedBackend;
				setStatus(`🔍 ${backendLabel}: searching...`);
				try {
					const results = await runBackend(
						requestedBackend,
						params.query,
						numResults,
						signal,
					);
					setStatus(`🔍 ${backendLabel}: ${results.length} results`);
					return {
						content: [
							{
								type: "text",
								text: compact
									? formatResultsCompact(results)
									: formatResults(params.query, requestedBackend, results),
							},
						],
						details: { backend: requestedBackend, resultCount: results.length },
					};
				} catch (err) {
					setStatus(`❌ ${backendLabel}: failed`);
					throw err;
				}
			}

			const activeBackends = getActiveBackends();
			if (activeBackends.length === 0) {
				throw new Error(
					"No search backends enabled. Enable at least one in ~/.pi/agent/extensions/search.json",
				);
			}

			if (effectiveCombine) {
				if (combineMode === "targeted") {
					const orderedBackends = selectBackendsForFallback(activeBackends);
					setStatus(`🔍 targeted combine: up to 3 of ${activeBackends.length} backends...`);
					const {
						results: combined,
						backendStats,
						usableBackendCount,
					} = await runTargetedCombine({
						orderedBackends,
						query: params.query,
						numResults,
						signal,
						runBackend,
					});

					if (usableBackendCount === 0) {
						setStatus(`❌ targeted combine: no usable backends`);
						const errors = Array.from(backendStats.entries()).map(([backend, stats]) =>
							stats.success
								? `${backend}: 0 results`
								: `${backend}: ${stats.error || "failed"}`,
						);
						throw new Error(
							`Targeted combine found no usable backend results: ${errors.join("; ")}`,
						);
					}

					const attemptedCount = backendStats.size;
					const incomplete =
						usableBackendCount < 3 ? `, exhausted after ${usableBackendCount} usable` : "";
					setStatus(
						`🔍 targeted combined: ${combined.length} results (${usableBackendCount}/${attemptedCount} usable${incomplete})`,
					);

					return {
						content: [
							{
								type: "text",
								text: compact
									? formatCombinedResultsCompact(combined)
									: formatCombinedResults(
											params.query,
											combined,
											backendStats,
											BACKEND_DEFS,
										),
							},
						],
						details: {
							backend: "combined-targeted",
							resultCount: combined.length,
							usableBackendCount,
							backendStats: Object.fromEntries(backendStats),
						},
					};
				}

				setStatus(`🔍 combine: ${activeBackends.length} backends...`);
				const resultsPerBackend = await Promise.all(
					activeBackends.map(async (backend) => {
						try {
							const results = await runBackend(
								backend,
								params.query,
								Math.ceil(numResults / activeBackends.length),
								signal,
							);
							return {
								backend,
								results: results.map((r) => ({
									...r,
									backend,
								})) as SearchResultWithBackend[],
								success: true,
							};
						} catch (err) {
							return {
								backend,
								results: [] as SearchResultWithBackend[],
								success: false,
								error: (err as Error).message,
							};
						}
					}),
				);

				const backendStats = new Map<
					string,
					{ success: boolean; count: number; error?: string }
				>();

				for (const { backend, results, success, error } of resultsPerBackend) {
					backendStats.set(backend, {
						success,
						count: results.length,
						error,
					});
				}

				const successfulBackends = resultsPerBackend
					.filter((r) => r.success && r.results.length > 0)
					.map((r) => ({ backend: r.backend, results: r.results }));

				const combined =
					successfulBackends.length > 0
						? reciprocalRankFusion(successfulBackends, numResults)
						: [];

				const successCount = successfulBackends.length;
				const failCount = activeBackends.length - successCount;
				setStatus(
					`🔍 combined: ${combined.length} results (${successCount} ok${failCount > 0 ? `, ${failCount} failed` : ""})`,
				);

				return {
					content: [
						{
							type: "text",
							text: compact
								? formatCombinedResultsCompact(combined)
								: formatCombinedResults(
										params.query,
										combined,
										backendStats,
										BACKEND_DEFS,
									),
						},
					],
					details: {
						backend: "combined",
						resultCount: combined.length,
						backendStats: Object.fromEntries(backendStats),
					},
				};
			}

			const orderedBackends =
				combineMode === "rotate"
					? selectBackendsForRotate(activeBackends)
					: selectBackendsForFallback(activeBackends);
			const errors: string[] = [];
			const rotateStart = orderedBackends[0];
			for (const backend of orderedBackends) {
				const backendLabel = BACKEND_DEFS[backend]?.label || backend;
				const rotateHint =
					combineMode === "rotate" && backend === rotateStart
						? " (rotate)"
						: combineMode === "rotate"
							? " (rotate fallback)"
							: "";
				setStatus(`🔍 ${backendLabel}${rotateHint}: searching...`);
				try {
					const results = await runBackend(backend, params.query, numResults, signal);
					setStatus(`🔍 ${backendLabel}: ${results.length} results`);
					const usedFallback = errors.length > 0;
					const modeTag =
						combineMode === "rotate"
							? usedFallback
								? `${backend} (rotate fallback)`
								: `${backend} (rotate)`
							: usedFallback
								? `${backend} (fallback)`
								: backend;
					return {
						content: [
							{
								type: "text",
								text:
									errors.length > 0
										? `${errors.join("; ")}\n\n${compact ? formatResultsCompact(results) : formatResults(params.query, backend, results)}`
										: compact
											? formatResultsCompact(results)
											: formatResults(params.query, backend, results),
							},
						],
						details: {
							backend: modeTag,
							resultCount: results.length,
							errors: errors.length > 0 ? errors : undefined,
						},
					};
				} catch (err) {
					errors.push(`${backend}: ${(err as Error).message}`);
					setStatus(`❌ ${backendLabel}: failed, trying next...`);
				}
			}

			setStatus(`❌ all backends failed`);
			throw new Error(`All backends failed: ${errors.join("; ")}`);
		},
	});
}

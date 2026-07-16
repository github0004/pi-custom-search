/** Result formatting for web_search. */

import type { SearchResult, SearchResultWithBackend, BackendRunner } from "../types.js";

export function formatResultsCompact(results: SearchResult[]): string {
	if (results.length === 0) return "No results.";
	const lines = results.map((r, i) => {
		const title = (r.title || "Untitled").slice(0, 60);
		const url = r.url.length > 50 ? r.url.slice(0, 47) + "..." : r.url;
		return `${i + 1}. ${title} — ${url}`;
	});
	return lines.join("\n");
}

export function formatCombinedResultsCompact(results: SearchResultWithBackend[]): string {
	if (results.length === 0) return "No results.";
	const lines = results.map((r, i) => {
		const title = (r.title || "Untitled").slice(0, 60);
		const url = r.url.length > 50 ? r.url.slice(0, 47) + "..." : r.url;
		const src = r.backend ? ` [${r.backend}]` : "";
		return `${i + 1}. ${title}${src} — ${url}`;
	});
	return lines.join("\n");
}

export function formatResults(query: string, backend: string, results: SearchResult[]): string {
	const safeQuery = query.replace(/[\n\r]/g, " ").replace(/^#/gm, "\\#");
	const lines: string[] = [
		`## Search Results: "${safeQuery}"`,
		`Backend: ${backend}  ·  Results: ${results.length}`,
		"",
	];
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		lines.push(`### ${i + 1}. ${r.title || "Untitled"}`);
		lines.push(`   URL: ${r.url}`);
		const displayText = r.snippet || r.content || "";
		if (displayText) {
			const text = displayText.slice(0, 500);
			lines.push(`   ${text}${displayText.length > 500 ? "..." : ""}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}

export function formatCombinedResults(
	query: string,
	results: SearchResultWithBackend[],
	backendStats: Map<string, { success: boolean; count: number; error?: string }>,
	backendDefs: Record<string, BackendRunner>,
): string {
	const safeQuery = query.replace(/[\n\r]/g, " ").replace(/^#/gm, "\\#");
	const lines: string[] = [
		`## Search Results: "${safeQuery}"`,
		`Mode: combined  ·  Results: ${results.length}`,
		"",
	];

	const backendLabel = Object.fromEntries(
		Object.entries(backendDefs).map(([k, v]) => [k, v.label]),
	) as Record<string, string>;

	lines.push("**Backends queried:**");
	for (const [backend, stats] of backendStats.entries()) {
		const label = backendLabel[backend] || backend;
		if (stats.success) {
			lines.push(`  - ${label}: ${stats.count} results`);
		} else {
			lines.push(`  - ${label}: failed (${stats.error || "unknown error"})`);
		}
	}
	lines.push("");

	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		lines.push(`### ${i + 1}. ${r.title || "Untitled"}`);
		if (r.backend) {
			lines.push(`   *Source: ${backendLabel[r.backend] || r.backend}*`);
		}
		lines.push(`   URL: ${r.url}`);
		const displayText = r.snippet || r.content || "";
		if (displayText) {
			const text = displayText.slice(0, 500);
			lines.push(`   ${text}${displayText.length > 500 ? "..." : ""}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}

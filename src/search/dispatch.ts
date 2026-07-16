/** Dispatch: sequential fallback, round-robin rotate, RRF combine, targeted combine. */

import type { SearchResult, SearchResultWithBackend } from "../types.js";

export type BackendStats = { success: boolean; count: number; error?: string };

/** Module-level cursor so each search request advances to the next backend. */
let rotateCursor = 0;

export function selectBackendsForFallback(activeBackends: string[]): string[] {
	return [...activeBackends];
}

/**
 * Round-robin: return backends ordered starting at the next cursor position,
 * then advance the cursor for the following request.
 */
export function selectBackendsForRotate(activeBackends: string[]): string[] {
	if (activeBackends.length === 0) return [];
	const start = rotateCursor % activeBackends.length;
	rotateCursor = (rotateCursor + 1) % activeBackends.length;
	return [...activeBackends.slice(start), ...activeBackends.slice(0, start)];
}

/** Reset rotate cursor (useful for tests). */
export function resetRotateCursor(): void {
	rotateCursor = 0;
}

export async function runTargetedCombine({
	orderedBackends,
	query,
	numResults,
	signal,
	targetUsableBackends = 3,
	runBackend,
}: {
	orderedBackends: string[];
	query: string;
	numResults: number;
	signal?: AbortSignal;
	targetUsableBackends?: number;
	runBackend: (
		backend: string,
		query: string,
		numResults: number,
		signal?: AbortSignal,
	) => Promise<SearchResult[]>;
}): Promise<{
	results: SearchResultWithBackend[];
	backendStats: Map<string, BackendStats>;
	usableBackendCount: number;
}> {
	const backendStats = new Map<string, BackendStats>();
	const usableBackends: Array<{ backend: string; results: SearchResultWithBackend[] }> = [];
	const perBackendResults = Math.max(1, Math.ceil(numResults / targetUsableBackends));
	let cursor = 0;

	while (usableBackends.length < targetUsableBackends && cursor < orderedBackends.length) {
		const needed = targetUsableBackends - usableBackends.length;
		const remaining = orderedBackends.length - cursor;
		const batchSize = Math.min(needed, remaining);
		const batch = orderedBackends.slice(cursor, cursor + batchSize);
		cursor += batchSize;

		const batchResults = await Promise.all(
			batch.map(async (backend) => {
				try {
					const results = await runBackend(backend, query, perBackendResults, signal);
					return {
						backend,
						results: results.map((r) => ({ ...r, backend })) as SearchResultWithBackend[],
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

		for (const { backend, results, success, error } of batchResults) {
			backendStats.set(backend, {
				success,
				count: results.length,
				error,
			});
			if (success && results.length > 0) {
				usableBackends.push({ backend, results });
			}
		}
	}

	return {
		results:
			usableBackends.length > 1
				? reciprocalRankFusion(usableBackends, numResults)
				: (usableBackends[0]?.results.slice(0, numResults) ?? []),
		backendStats,
		usableBackendCount: usableBackends.length,
	};
}

function normalizeUrl(url: string): string {
	try {
		const u = new URL(url);
		u.hash = "";
		u.pathname = u.pathname.replace(/\/+$/, "") || "/";
		return u.toString().toLowerCase();
	} catch {
		return url.toLowerCase();
	}
}

/**
 * Merge results from multiple backends using Reciprocal Rank Fusion (k=60).
 */
export function reciprocalRankFusion(
	backendResults: Array<{ backend: string; results: SearchResultWithBackend[] }>,
	maxResults: number,
): SearchResultWithBackend[] {
	const K = 60;
	const urlMap = new Map<
		string,
		{ rrfScore: number; result: SearchResultWithBackend; backends: string[] }
	>();

	for (const { backend, results } of backendResults) {
		for (let rank = 0; rank < results.length; rank++) {
			const r = results[rank];
			const key = normalizeUrl(r.url);

			const existing = urlMap.get(key);
			const rrfContribution = 1 / (K + rank + 1);

			if (existing) {
				existing.rrfScore += rrfContribution;
				existing.backends.push(backend);
				const existingLen = (existing.result.content ?? existing.result.snippet ?? "").length;
				const newLen = (r.content ?? r.snippet ?? "").length;
				if (newLen > existingLen) {
					existing.result = { ...r, backend };
				}
			} else {
				urlMap.set(key, {
					rrfScore: rrfContribution,
					result: { ...r, backend },
					backends: [backend],
				});
			}
		}
	}

	return Array.from(urlMap.values())
		.sort((a, b) => {
			if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
			return b.backends.length - a.backends.length;
		})
		.slice(0, maxResults)
		.map((entry) => entry.result);
}

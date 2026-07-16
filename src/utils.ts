/** Shared utilities for pi-custom-search. */

import { join } from "node:path";

export const HTTP_TIMEOUT_MS = 30_000;
export const COOLDOWN_MS = 2_000;

export const MISSING_KEY_HELP =
	"Set a literal apiKey for the backend in ~/.pi/agent/extensions/search.json " +
	"(or project .pi/search.json).";

export function getAgentDir(): string {
	return join(process.env.HOME || process.env.USERPROFILE || "~", ".pi", "agent");
}

const backendCooldowns = new Map<string, number>();

export function waitForCooldown(backend: string): Promise<void> {
	const until = backendCooldowns.get(backend);
	if (!until) return Promise.resolve();
	const delay = until - Date.now();
	if (delay <= 0) return Promise.resolve();
	return new Promise((r) => setTimeout(r, delay));
}

export function markCooldown(backend: string): void {
	backendCooldowns.set(backend, Date.now() + COOLDOWN_MS);
}

export function clearCooldowns(): void {
	backendCooldowns.clear();
}

/** Combine an optional caller signal with a timeout. */
export function timeoutSignal(signal?: AbortSignal, timeoutMs?: number): AbortSignal {
	const effectiveTimeout = timeoutMs ?? HTTP_TIMEOUT_MS;
	if (!signal) return AbortSignal.timeout(effectiveTimeout);
	return AbortSignal.any([signal, AbortSignal.timeout(effectiveTimeout)]);
}

export function isPrivateHost(host: string): boolean {
	const lower = host.toLowerCase();

	if (lower === "localhost" || lower === "localhost.localdomain") return true;
	if (lower === "127.0.0.1" || lower === "::1" || lower === "0.0.0.0") return true;

	try {
		let ip = host;
		if (ip.startsWith("::ffff:")) {
			ip = ip.slice(7);
		}

		if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
			const parts = ip.split(".").map(Number);

			if (parts[0] === 127) return true;
			if (parts[0] === 10) return true;
			if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
			if (parts[0] === 192 && parts[1] === 168) return true;
			if (parts[0] === 169 && parts[1] === 254) return true;
			if (parts.every((p) => p === 0)) return true;
		}
	} catch {
		// ignore
	}

	return false;
}

/** Returns an error message if the URL is unsafe, or null if OK. */
export function validateUrl(url: string): string | null {
	try {
		const parsed = new URL(url);

		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return `SSRF blocked: only http/https allowed, got ${parsed.protocol}`;
		}

		if (isPrivateHost(parsed.hostname)) {
			return `SSRF blocked: private host ${parsed.hostname}`;
		}

		if (parsed.username || parsed.password) {
			return `SSRF blocked: credentials in URL not allowed`;
		}

		const port = parsed.port ? parseInt(parsed.port, 10) : 0;
		if (port > 0 && port < 1024 && ![80, 443, 8080, 8443].includes(port)) {
			return `SSRF blocked: privileged port ${port} not allowed`;
		}

		return null;
	} catch {
		return `Invalid URL: ${url}`;
	}
}

export function sanitizeError(status: number, text: string): string {
	const safe = text
		.replace(/(bearer|token)\s+[\w.\/-]{8,}/gi, "$1 [redacted]")
		.replace(
			/(api[-_]?key|bearer|token|authorization|secret|password)["']?\s*[:=]\s*["']?[\w.\/-]{8,}/gi,
			"[redacted]",
		)
		.replace(
			/"(?:api[-_]?key|apiKey|token|secret|password|bearer)"\s*:\s*"[^"']{8,}"/gi,
			'"[redacted]"',
		)
		.replace(/(x-api-key|authorization)\s*:\s*[\w.\/-]{8,}/gi, "$1: [redacted]")
		.slice(0, 300);
	return `API error (${status}): ${safe}`;
}

/** TLS-fingerprint fetch via impit. */

import { Impit } from "impit";
import { validateUrl, timeoutSignal } from "../utils.js";
import { resolveMaxBytes, type FetchResult } from "./fetch.js";

export async function fingerprintFetch(
	url: string,
	options: {
		signal?: AbortSignal;
		timeoutMs?: number;
		maxBytes?: number;
	} = {},
): Promise<FetchResult> {
	const ssrf = validateUrl(url);
	if (ssrf) throw new Error(ssrf);

	const maxBytes = resolveMaxBytes(options.maxBytes);
	const signal = timeoutSignal(options.signal, options.timeoutMs);

	const impit = new Impit({
		browser: "chrome142",
		followRedirects: true,
		maxRedirects: 5,
	});

	const response = await impit.fetch(url, {
		method: "GET",
		signal,
	});

	const contentType = response.headers.get("content-type") ?? "text/html";
	const ab = await response.arrayBuffer();
	const truncated = ab.byteLength > maxBytes;
	const slice = truncated ? ab.slice(0, maxBytes) : ab;
	const html = Buffer.from(slice).toString("utf-8");

	return {
		url,
		finalUrl: response.url || url,
		status: response.status,
		contentType,
		html,
		bytes: ab.byteLength,
		truncated,
	};
}

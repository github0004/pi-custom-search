/**
 * pi-custom-search — web_search (random multi-backend) + local web_read (CloakBrowser).
 *
 * Config: ~/.pi/agent/extensions/search.json + .pi/search.json (project wins)
 * Credentials: literal apiKey only
 *
 * Context safety: detects pi-context and steers checkpoint/timeline/compact between
 * noisy search/read bursts so results do not overflow the context window.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { config, refreshConfig, getActiveBackends } from "./config.js";
import {
	bindContextSafetyApi,
	isContextTool,
	isPiContextAvailable,
	noteContextCheckpoint,
	noteContextCompacted,
	resetContextSafetySession,
} from "./context-safety.js";
import { clearCooldowns } from "./utils.js";
import { registerWebSearch } from "./search/web-search.js";
import { registerWebRead } from "./read/web-read.js";
import { closeAllBrowsers } from "./read/browser.js";

function wireCleanupHooks(): void {
	const cleanup = () => {
		void closeAllBrowsers();
	};
	process.once("SIGTERM", cleanup);
	process.once("SIGINT", cleanup);
	process.once("beforeExit", cleanup);
}

export default function (pi: ExtensionAPI): void {
	bindContextSafetyApi(pi);
	registerWebSearch(pi);
	registerWebRead(pi);
	wireCleanupHooks();

	pi.on("session_start", (_event, ctx) => {
		clearCooldowns();
		resetContextSafetySession();
		refreshConfig(ctx.cwd, true);
		// Re-detect after tools from other packages are registered.
		isPiContextAvailable(true);

		if (config.showStatus !== false) {
			const backends = getActiveBackends();
			const ctxLabel = isPiContextAvailable() ? " · pi-context" : "";
			const label =
				backends.length > 0
					? `search: ${backends.join(", ")}${ctxLabel}`
					: `search: (no backends enabled)${ctxLabel}`;
			ctx.ui.setStatus("search", label);
		}
	});

	pi.on("session_compact", () => {
		noteContextCompacted();
	});

	// Reset counters when pi-context successfully checkpoints / compacts.
	pi.on("tool_result", (event) => {
		if (event.isError || !isContextTool(event.toolName)) return;
		if (event.toolName === "context_compact") {
			noteContextCompacted();
			return;
		}
		if (event.toolName === "context_checkpoint") {
			const text = event.content
				.map((c) => (typeof c.text === "string" ? c.text : ""))
				.join(" ");
			if (/^Error:/i.test(text.trim())) return;
			noteContextCheckpoint();
		}
	});
}

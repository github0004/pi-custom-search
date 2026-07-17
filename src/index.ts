/**
 * pi-custom-search — web_search (random multi-backend) + local web_read (CloakBrowser).
 *
 * Config: ~/.pi/agent/extensions/search.json + .pi/search.json (project wins)
 * Credentials: literal apiKey only
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { config, refreshConfig, getActiveBackends } from "./config.js";
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
	registerWebSearch(pi);
	registerWebRead(pi);
	wireCleanupHooks();

	pi.on("session_start", (_event, ctx) => {
		clearCooldowns();
		refreshConfig(ctx.cwd, true);
		if (config.showStatus !== false) {
			const backends = getActiveBackends();
			const label =
				backends.length > 0
					? `search: ${backends.join(", ")}`
					: "search: (no backends enabled)";
			ctx.ui.setStatus("search", label);
		}
	});
}

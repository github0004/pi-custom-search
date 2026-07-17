/** Config loading for pi-custom-search. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BackendConfig, BackendName, SearchConfig } from "./types.js";
import { BACKEND_NAMES } from "./types.js";
import { resolveBackendKey } from "./credentials.js";
import { getAgentDir } from "./utils.js";

export let config: SearchConfig = {
	defaultBackend: "auto",
	backends: {},
};

function loadConfig(cwd: string): SearchConfig {
	const globalPath = join(getAgentDir(), "extensions", "search.json");
	const projectPath = join(cwd, ".pi", "search.json");

	let loaded: SearchConfig = {
		defaultBackend: "auto",
		backends: {},
	};

	if (existsSync(globalPath)) {
		try {
			loaded = { ...loaded, ...JSON.parse(readFileSync(globalPath, "utf-8")) };
		} catch {
			// ignore
		}
	}

	const preProjectBackends = { ...(loaded.backends ?? {}) };

	if (existsSync(projectPath)) {
		try {
			const project = JSON.parse(readFileSync(projectPath, "utf-8"));
			loaded = { ...loaded, ...project };
			if (loaded.backends == null) {
				loaded.backends = preProjectBackends;
			}
			if (project.backends && typeof project.backends === "object") {
				const merged: Record<string, BackendConfig | undefined> = {
					...preProjectBackends,
					...loaded.backends,
				};
				for (const [key, val] of Object.entries(project.backends)) {
					const bc = val as BackendConfig | undefined;
					if (bc && merged[key]) {
						merged[key] = { ...merged[key], ...bc };
					} else {
						merged[key] = bc;
					}
				}
				loaded.backends = merged as SearchConfig["backends"];
			}
		} catch {
			// ignore
		}
	}

	if (
		loaded.defaultBackend &&
		loaded.defaultBackend !== "auto" &&
		!BACKEND_NAMES.includes(loaded.defaultBackend as BackendName)
	) {
		loaded.defaultBackend = "auto";
	}

	return loaded;
}

let activeBackendsList: string[] = [];
let configCacheTime = 0;
let configCacheCwd = "";
const CONFIG_TTL_MS = 10_000;

export function refreshConfig(cwd: string, force = false): string[] {
	const now = Date.now();
	if (!force && cwd === configCacheCwd && now - configCacheTime < CONFIG_TTL_MS) {
		return activeBackendsList;
	}

	config = loadConfig(cwd);
	configCacheTime = now;
	configCacheCwd = cwd;

	// Enabled + keyed only — skip doomed attempts in auto shuffle.
	activeBackendsList = Object.entries(config.backends || {})
		.filter(
			([name, bc]) =>
				BACKEND_NAMES.includes(name as BackendName) &&
				bc?.enabled &&
				resolveBackendKey(name, config) !== undefined,
		)
		.map(([name]) => name);

	return activeBackendsList;
}

export function getActiveBackends(): string[] {
	return activeBackendsList;
}

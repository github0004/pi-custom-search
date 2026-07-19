# pi-custom-search

Pi extension with two tools:

- **`web_search`** — search across brave, serper, tavily, exa, and linkup (random pick with fallback)
- **`web_read`** (aliases: `web_fetch`, `web_fetch_and_index`) — fetch a URL locally (undici → fingerprint → CloakBrowser), return **query-ranked excerpts by default** (or full page / vault save) — **no Exa/Jina readers**

## Install

```bash
pi install /path/to/pi-custom-search
# or link the folder into your Pi packages
```

Then disable or uninstall **pi-search-hub** and **pi-scraper** so tool names do not collide.

## Config

Copy [search.json.example](./search.json.example) to:

- Global: `~/.pi/agent/extensions/search.json`
- Project override: `.pi/search.json` (deep-merges per backend)

Literal API keys only (paste keys inline). Drop any `reader` field from older search-hub configs — extraction is always local.

### Search dispatch

Auto mode shuffles **enabled backends that have an `apiKey`**: random primary, then the rest as fallback. Empty results and failures try the next provider; aborts stop immediately. Same behavior in-session and across sessions/processes.

- Pin with tool param `backend: "brave"` (etc.), or set `defaultBackend` in config.
- `combine` / `combineMode` from older search-hub configs are ignored.

### CloakBrowser

`npm install` runs `postinstall` → `cloakbrowser install` (prefetches the stealth Chromium binary into `~/.cloakbrowser/`). The binary auto-updates on launch by default.

Toggle a visible browser window via config or tool param:

```json
"read": { "headless": false }
```

Or per call: `web_read({ url, headless: false })`.

## Tools

| Tool | Params |
| ---- | ------ |
| `web_search` | `query`, `numResults`, `backend`, `compact`, `force` |
| `web_read` | `url`, `query`, `return`, `mode`, `format`, `onlyMainContent`, `maxChars` / `maxBytes`, `headless`, `savePath`, `saveDir`, `force` |

`web_read` `auto` mode escalates: fast HTTP → fingerprint (if blocked) → readability (if sparse) → CloakBrowser (if still thin/SPA).

### Chat returns (excerpts by default)

By default, chat gets **ranked excerpts**, not the whole page:

```text
web_read({ url, query: "fortinet multicast igmp snooping" })
```

- Pass `query` with what you need — local keyword/heading scoring picks relevant sections.
- Omit `query` → page outline (headings + short lead) and a nudge to focus or request full.
- `return: "full"` → entire main-content markdown (still subject to char caps).
- CloakBrowser / HTTP still acquire the full page; ranking happens after markdown extraction.

**Multi-page / vault scrapes:** set `saveDir` (or `savePath`). Full content goes to disk; the model only gets a short summary — prevents context overflow.

```text
web_read({ url, mode: "browser", saveDir: "~/vault/fortinet-multicast" })
```

## Context safety (pi-context)

Search/read bursts can fill the context window (e.g. stacked searches + a browser-read that embeds base64 images). This package detects whether [pi-context](https://pi.dev/packages/pi-context) is installed and steers the agent to manage history between searches:

1. **Detect** — active `context_*` tools, `settings.json` packages, or `~/.pi/agent/npm/node_modules/pi-context`
2. **Sanitize** — strip `data:` / base64 image payloads from `web_read` output; default `removeImages` for chat returns; progressive char caps as the burst grows
3. **Warn / manage** — after a few `web_*` ops (or high context % / char budget), append a `[context-safety]` footer for `context_checkpoint` → `context_timeline` → `context_compact`
4. **Soft-block** — when thresholds are exceeded, further `web_*` calls return a block message until a successful `context_compact` (counters also reset on Pi's built-in session compact)
5. **Fallback** — without pi-context, force compact search formatting and tighter read caps, and recommend installing it

Install the companion package:

```bash
pi install npm:pi-context
```

Tune thresholds in `search.json` under `contextSafety` (see [search.json.example](./search.json.example)). Set `"enabled": false` to disable.

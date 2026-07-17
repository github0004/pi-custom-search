# pi-custom-search

Pi extension with two tools:

- **`web_search`** — search across brave, serper, tavily, exa, and linkup (random pick with fallback)
- **`web_read`** (aliases: `web_fetch`, `web_fetch_and_index`) — fetch a URL locally (undici → fingerprint → CloakBrowser), return clean markdown — **no Exa/Jina readers**

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
| `web_search` | `query`, `numResults`, `backend`, `compact` |
| `web_read` | `url`, `mode`, `format`, `onlyMainContent`, `maxChars` / `maxBytes`, `headless`, `savePath`, `saveDir` |

`web_read` `auto` mode escalates: fast HTTP → fingerprint (if blocked) → readability (if sparse) → CloakBrowser (if still thin/SPA).

**Multi-page / vault scrapes:** set `saveDir` (or `savePath`). Full content goes to disk; the model only gets a short summary — prevents context overflow.

```text
web_read({ url, mode: "browser", saveDir: "~/vault/fortinet-multicast" })
```

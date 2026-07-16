# pi-custom-search

Pi extension with two tools:

- **`web_search`** — search across brave, serper, tavily, exa, and linkup (fallback, round-robin rotate, or RRF combine)
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

### Search dispatch (`combine` / `combineMode`)

| Setting | Behavior |
| ------- | -------- |
| `combineMode: "rotate"` | **Default in example** — round-robin: each request goes to the next enabled backend (ignores `combine`) |
| `combine: false` | Try enabled backends in order; first success wins |
| `combine: true`, `combineMode: "all"` | Query all enabled backends in parallel, merge with RRF |
| `combine: true`, `combineMode: "targeted"` | Fan out until ~3 usable backends, then RRF |

Example — round-robin rotate (recommended for spreading load across keys):

```json
{
  "combine": false,
  "combineMode": "rotate",
  "backends": { "...": "enabled backends" }
}
```

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
| `web_search` | `query`, `numResults`, `backend`, `combine`, `compact` |
| `web_read` | `url`, `mode`, `format`, `onlyMainContent`, `maxChars` / `maxBytes`, `headless`, `savePath`, `saveDir` |

`web_read` `auto` mode escalates: fast HTTP → fingerprint (if blocked) → readability (if sparse) → CloakBrowser (if still thin/SPA).

**Multi-page / vault scrapes:** set `saveDir` (or `savePath`). Full content goes to disk; the model only gets a short summary — prevents context overflow.

```text
web_read({ url, mode: "browser", saveDir: "~/vault/fortinet-multicast" })
```

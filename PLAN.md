# pi-custom-search — Build Plan

A new, streamlined Pi extension that **combines the best of two extensions I already run**:

- **pi-search-hub** (`~/.pi/agent/npm/node_modules/pi-search-hub`) — multi-backend `web_search`
- **pi-scraper** (`~/.pi/agent/npm/node_modules/pi-scraper`) — CloakBrowser-backed page reading/extraction

Goal: keep the **search** side (my 5 working API keys), throw away the search-hub `web_read`
(which relies on external readers — Exa / Jina), and replace it with the **scraper's
CloakBrowser full-page extraction** so `web_read` grabs the *whole* rendered page and hands
the AI clean, relevant content. Drop everything else I don't use.

### Locked decisions (confirmed)
1. **Extraction is purely local, always.** `web_read` never calls Exa/Jina/any reader API.
2. **Tool names:** reuse `web_search` / `web_read` (clean drop-in; uninstall the old two at cutover).
3. **Backends:** ship **exactly 5** — brave, serper, tavily, exa, linkup.
4. **No `chunks`** output — just clean markdown/text/html.
5. **Fully stateless** — no on-disk read cache.
6. **Build approach:** still deciding (crew vs. direct) — plan-refinement first.

---

## 1. What I actually have today

### pi-search-hub (v2.8.0)
- One `web_search` tool + one `web_read` tool.
- **19 backends**, auto-fallback + RRF "combine" mode.
- My live global config (`~/.pi/agent/extensions/search.json`) has **5 enabled backends**:
  - `brave`, `serper`, `tavily`, `exa`, `linkup` (all with keys)
  - `combine: true`, `combineMode: "all"`, `reader: "exa"`
- The part I **like**: the search dispatch (fallback + RRF combine across my keys).
- The part I **don't like**: `web_read` extracts via **Exa/Jina external readers**.

### pi-scraper
- CloakBrowser (`cloakbrowser` + `playwright-core`) browser mode with fingerprint patches.
- Scrape pipeline with modes: `fast`, `fingerprint`, `readable`, `browser`, `auto`.
- Readability + turndown → clean markdown; `onlyMainContent`, chunking, size limits.
- The part I **like**: `browser` mode + the HTML→clean-markdown pipeline = full page,
  extract everything relevant for the AI, no third-party reader API.
- The part I **don't need**: `web_crawl`, `web_map`, `web_batch`, `web_browser` (interactive
  driving), `web_extract` (verticals/selectors/patterns/LLM extraction), `web_get_result`,
  snapshots/diffing, proxy rotation, sessions, the 25+ verticals YAMLs, model-adapter, TUI, etc.

---

## 2. Target: what pi-custom-search ships

**Exactly two tools, one config file, minimal surface.**

| Tool | Source of design | What it does |
| :-- | :-- | :-- |
| `web_search` | search-hub dispatch | Search across my enabled backends (fallback, rotate, or RRF combine). Keep my 5 keys. |
| `web_read` | scraper pipeline | Fetch a URL, render with **CloakBrowser** when needed, return clean markdown — **no Exa/Jina**. |

Design principles:
- **Local-first extraction.** `web_read` never calls an external reader API. It uses the
  scraper's own fetch → (browser render if needed) → readability → turndown chain.
- **Keep search config compatible** so my existing `search.json` keys keep working.
- **Cut scope hard.** No crawl/map/batch/extract/verticals/snapshots/sessions/proxy-rotation.
- **One package, no peer dependency on either original.** Copy the minimal code I need.

---

## 3. Proposed structure

```
pi-custom-search/
├── package.json            # name: pi-custom-search; pi.extensions -> ./src/index.ts
├── README.md
├── PLAN.md                 # this file
├── tsconfig.json
├── search.json.example
└── src/
    ├── index.ts            # registers web_search + web_read, statusline, cleanup hooks
    ├── config.ts           # load/merge search.json (global + project), active backends
    ├── credentials.ts      # env / !shell / literal key resolution (from search-hub)
    ├── search/
    │   ├── web-search.ts   # the web_search tool (dispatch + combine)
    │   ├── dispatch.ts     # fallback / rotate / targeted/all combine
    │   ├── scoring.ts      # RRF
    │   ├── formatters.ts   # result formatting (verbose + compact)
    │   └── backends/       # ONLY the 5 I use: brave, serper, tavily, exa, linkup
    │       ├── registry.ts
    │       ├── brave.ts
    │       ├── serper.ts
    │       ├── tavily.ts
    │       ├── exa.ts
    │       └── linkup.ts
    └── read/
        ├── web-read.ts     # the web_read tool (thin wrapper over pipeline)
        ├── pipeline.ts     # fast → fingerprint → readable → browser (auto)
        ├── browser.ts      # CloakBrowser render (trimmed from scraper)
        ├── readable.ts     # readability extraction
        └── markdown.ts     # HTML → markdown (turndown + gfm)
```

Dependencies (from scraper's set, only what `web_read` needs):
`cloakbrowser`, `playwright-core`, `@mozilla/readability`, `linkedom` (or `htmlparser2`+
`domhandler`+`domutils`+`dom-serializer`), `turndown`, `turndown-plugin-gfm`, `impit`/`undici`,
`typebox`. Search side needs `wreq-js`/`undici` for HTTP + `typebox`.

---

## 4. web_read behavior (the key change)

Parameters (trimmed):
- `url` (required)
- `mode`: `auto` (default) | `fast` | `fingerprint` | `readable` | `browser`
- `format`: `markdown` (default) | `text` | `html`
- `onlyMainContent`: boolean (default true) — readability cleanup
- `maxChars` / `maxBytes`: size guard

Flow (`auto`):
1. `fast` HTTP fetch. If it returns solid HTML/text → readability → markdown, done.
2. If blocked / JS-heavy signals → escalate to `fingerprint`, then `browser` (CloakBrowser).
3. `browser` renders the full page, returns HTML → readability → turndown → clean markdown.
4. Apply `onlyMainContent` + size limits.

Result: "grab the full data of the webpage and extract everything relevant for the AI" —
using CloakBrowser locally, **not** Exa/Jina. Fully stateless: every call fetches fresh.

---

## 5. web_search behavior (keep what I like)

- Reuse search-hub dispatch: auto-fallback, `combine` (RRF), or `combineMode: "rotate"` (round-robin).
- Registry trimmed to my 5 backends (brave, serper, tavily, exa, linkup) — easy to add more later.
- Same config schema so my existing `search.json` keeps working (drop `reader` field —
  no longer relevant since extraction is local).
- Keep credential resolution (env var refs, `!shell`, literal).
- Registry ships **only** the 5 backends. Adding another later = write one backend file
  + one registry entry (no other edits).

---

## 6. Migration / cutover

1. Build pi-custom-search, `pi install` it locally (link the project folder).
2. Point config at the same keys (copy the 5 backends into `search.json.example`).
3. Uninstall / disable pi-search-hub and pi-scraper so tool names don't collide
   (both register `web_search` / `web_read` / `web_*`).
4. Smoke test: a search query (combine on) + a `web_read` on a JS-heavy page to confirm
   CloakBrowser path works and no Exa/Jina calls happen.

---

## 7. Remaining open question

- **Build approach:** drive the implementation with the **crew** (planner → worker → reviewer
  markdown handoff), or implement it directly here step by step? (Everything else is locked.)

## 9. Config design (finalized)

Single `search.json` — global `~/.pi/agent/extensions/search.json`, project `.pi/search.json`
overrides (deep-merged per backend). See `search.json.example`.

**Credential style:** literal keys only (paste raw keys inline, matches current setup).
No env-var refs / no `!shell` resolver — keeps the resolver trivial.

### Top-level keys
| Key | Type | Default | Purpose |
| :-- | :-- | :-- | :-- |
| `defaultBackend` | string | `"auto"` | Lead backend / try-order. |
| `combine` | boolean | `false` | Parallel RRF merge vs. first-success fallback (ignored when `combineMode` is `rotate`). |
| `combineMode` | `all`/`targeted`/`rotate` | `"rotate"` | All backends, stop at ~3 usable, or round-robin one provider per request. |
| `compact` | boolean | `false` | Single-line results vs. full snippets. |
| `showStatus` | boolean | `true` | Statusline search indicator. |
| `numResults` | number | `10` | Default result cap. |

### `read` block (extraction defaults)
| Key | Type | Default | Purpose |
| :-- | :-- | :-- | :-- |
| `defaultMode` | `auto`/`fast`/`fingerprint`/`readable`/`browser` | `auto` | Escalation strategy. |
| `defaultFormat` | `markdown`/`text`/`html` | `markdown` | Output format. |
| `onlyMainContent` | boolean | `true` | Readability cleanup. |
| `removeImages` | boolean | `false` | Strip image markdown (token savings). |
| `maxChars` | number | `0` | Size guard (0 = no limit). |
| `timeoutSeconds` | number | `30` | Per-fetch timeout. |

### Per-backend keys (the 5)
`{ enabled, apiKey }` for brave/serper/tavily/exa; linkup adds `depth` (`standard`/`deep`).
Optional overrides available on any: `maxResults`, `timeout`.

### Explicitly cut
`reader`, `cacheTtl`/`cacheMax`, `selectionStrategy` (combine-only workflow),
backend-specific keys for dropped backends (instanceUrl, model, ddgs*, tokenBudget,
searchDepth, topic, baseUrl), and all scraper proxy/session/robots/retry/snapshot config.

## 8. Trimmed web_read parameters (final)

- `url` (required)
- `mode`: `auto` (default) | `fast` | `fingerprint` | `readable` | `browser`
- `format`: `markdown` (default) | `text` | `html`
- `onlyMainContent`: boolean (default true)
- `maxChars` / `maxBytes`: size guard

(No `fresh`, no `chunks`, no sessions, no proxy, no snapshots.)
```
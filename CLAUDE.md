# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Mapa Territorios is a React + Vite web app for visualizing and managing "territory" assignments on an interactive Leaflet map, for a Jehovah's Witness-style congregation field-service tracking use case (territories, publishers, zones). It's protected by Google OAuth via Supabase, with an admin panel for user/role management. A read-only MCP server (`mcp-server/`) exposes the same territory data as natural-language-queryable tools.

## Commands

Run from repo root unless noted.

- `npm run dev` — start Vite dev server
- `npm run build` — regenerates `public/data/territories.json` from KML files (via `import-kml`), then builds with Vite. Always runs KML import first — this is required for the map to have data.
- `npm run import-kml` — standalone: converts `/kmlfiles/*.kml` → `public/data/territories.json` (`scripts/import-kmls.js`)
- `npm run lint` — ESLint (flat config, `eslint.config.js`)
- `npm run preview` — preview a production build
- `npm test` — `node --test` over `src/lib/dates.test.js` (date parsing) and `mcp-server/tools.test.js` (MCP tools against an inline fixture CSV). No browser/React tests exist; these two files are the whole suite. They need root `node_modules` (papaparse) but not `mcp-server/node_modules` — the tool tests deliberately avoid the MCP SDK by calling the registered handlers directly.
- `npm run auditar-fechas [url-o-fichero]` — runs `src/lib/dates.js` over every date cell of the live sheet (or a local CSV) and reports which values it can't parse and which it recovered as day/month-swapped. Use this after touching the parser, or when someone reports a wrong date: it names the territory and column to fix in the sheet.

### MCP server (`mcp-server/`)

Separate Node package, not part of the Vite app's dependency tree.

- `cd mcp-server && npm install`
- `npm start` (or `node index.js`) — runs the stdio MCP server directly
- Register with Claude Code: `claude mcp add territorios-mcp -- node "<abs-path>/mcp-server/index.js"`

### Evals (`scripts/eval/`)

Separate Node package, not part of the Vite app's dependency tree. Needs a root `.env` with the Langfuse, Anthropic, and MCP variables.

- `cd scripts/eval && npm install`
- `npm run seed` — upload `dataset.json` to the Langfuse dataset `ask-territorios-v1`
- `npm run eval` — run the experiment and print scores
- `node --env-file=.env scripts/langfuse-seed-prompt.mjs` (from repo root) — push the system prompt to Langfuse
- `node --env-file=.env scripts/langfuse-otel-spike.mjs` (from repo root) — debug the OTLP wire format when traces stop appearing

## Architecture

### Data pipeline: two independent sources merged at runtime

Territory data comes from two places that are merged client-side, not at build time:

1. **Geometry (KML → GeoJSON)**: `.kml` files in `/kmlfiles` are converted by `scripts/import-kmls.js` into `public/data/territories.json` as part of `npm run build`. Each feature gets a `sourceFile` property (e.g. `"TERRITORIO 1.kml"`) used later for ID matching.
2. **Status/assignment data (Google Sheets)**: `src/lib/sheets.js` fetches a published Google Sheet as CSV at runtime (client-side fetch, not build-time) and parses it into territory records — status (`free`/`assigned`), current publisher, assignment history, and a computed "expired" flag (assigned ≥ ~4 months / 122 days ago). The sheet has a fixed column layout: `id, zone, numViviendas, status, lastCompletedDate`, followed by repeating groups of 3 columns (`publisher, assignedDate, completedDate`) representing assignment history over time.
3. **Merge**: `src/lib/territories.js#mergeTerritoryData` joins the GeoJSON features to sheet rows by matching `feature.properties.name` (or an ID extracted from `sourceFile` via the `TERRITORIO (\d+)\.kml` pattern) against the sheet's `id` column. This merge happens in `App.jsx` on every data load, not as a build step — the sheet is the live source of truth for status, the KML is the live-enough source of truth for shape.

The same sheet-parsing logic (`fetchTerritoryData`) is reused as-is by `mcp-server/data.js` (imported directly from `../src/lib/sheets.js`), so the MCP server and the web app share identical parsing/expiry logic. The MCP server adds a 60s in-memory cache on top, and honours `TERRITORIOS_SHEET_URL` to point at a different CSV (used by the tests).

**Dates are hand-typed and must go through `src/lib/dates.js`.** The sheet is filled in by hand, so the same column can hold `3/6/2026`, `03-06-26`, `2026-06-03`, `3 de junio de 2026`, a compact `03062026` or a spreadsheet serial number. `parseSheetDate` is the single tolerant parser (day-first convention, 2-digit years, swapped day/month recovery flagged as `ambigua`); `sheets.js` and every MCP tool use it. Don't add another inline `split('/')` date parse — that's exactly what this module replaced. The same file resolves relative ranges (`resolveRango`/`resolvePeriodo`/`resolveMes`), which is deliberate: the agent doesn't know today's date, so periods like "la semana pasada" are resolved server-side and echoed back as `rangoResuelto`.

### Auth & authorization (`src/context/AuthContext.jsx`)

- Supabase Google OAuth. `AuthProvider` wraps the app; `useAuth()` exposes `user`, `profile`, `isAdmin` (`profile.role === 'admin'`), `isActive` (`profile.is_active === true`).
- Profile fetch has built-in retry with exponential backoff (handles the DB trigger race where a new user's `profiles` row hasn't been created yet by a Postgres trigger).
- On a failed profile re-fetch, the previous profile is deliberately kept (not cleared) to avoid kicking an already-authenticated user out due to a transient network blip — see the `prevProfile` fallback logic. Don't "simplify" this away.
- `App.jsx` gates rendering on `authLoading` → `!user` (LoginPage) → `!isActive` (AccessPending) → main app, in that order.

### Admin operations go through Supabase Edge Functions, not the client directly

`supabase/functions/send-invitation` and `supabase/functions/delete-user` are Deno edge functions that perform privileged operations (inviting users, cascading account deletion) using the Supabase service-role key. They independently re-verify the caller is an admin (via the caller's own JWT against `profiles.role`) before using the admin client — the client-side `isAdmin` check is UI-only and must not be trusted as the authorization boundary. Any new privileged admin action should follow this same pattern (edge function + server-side re-check), not a direct client-side Supabase call.

### Observability (Langfuse)

The `ask-territorios` agent is traced to Langfuse Cloud EU.

- **Transport**: `supabase/functions/_shared/langfuse.ts` hand-builds OTLP/HTTP JSON and POSTs it to `/api/public/otel/v1/traces`. It has **zero dependencies on purpose** — it runs in the Deno edge runtime. Do not "improve" this by pulling in the Langfuse SDK or an OTEL stack.
- **Never blocks**: the flush runs via `EdgeRuntime.waitUntil` after the response is returned, and every Langfuse call is wrapped in try/catch. If `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` are absent, all tracing silently no-ops so local dev works without Langfuse. Preserve both properties.
- **Tool observations are reconstructed**, not measured. Anthropic's MCP connector executes tools on its own servers, so we only get `mcp_tool_use`/`mcp_tool_result` blocks back — name, args, result, but no latency. They are recorded with zero duration and `metadata.reconstructed=true`. Trace context also cannot cross the MCP connector, which is why `api/mcp.js` is deliberately not instrumented.
- **System prompt lives in Langfuse** (`ask-territorios-system`, label `production`), fetched by `supabase/functions/_shared/prompt.ts` with a 60s module-scope cache. `FALLBACK_SYSTEM_PROMPT` in that file is the safety net and must stay in sync with the seeded prompt — `scripts/langfuse-seed-prompt.mjs` pushes it.
- **Evals**: `scripts/eval/` is an isolated Node package (like `mcp-server/`) so `@langfuse/client` stays out of the Vite app's tree. `npm run seed` uploads `dataset.json`; `npm run eval` runs the experiment. `expectedOutput` in the dataset is a **grading rubric, not a literal answer**, because territory data is a live Google Sheet and frozen answers would rot. The dataset must never contain real publisher names.
- **Known duplication**: `MODEL` and `MAX_TOKENS` exist in both `supabase/functions/ask-territorios/index.ts` and `scripts/eval/agent.mjs`. Change both together.
- **Env vars**: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_ENVIRONMENT` — set as Supabase secrets for the deployed function and in a gitignored root `.env` for the scripts.

### RLS / DB performance note (from README)

Row Level Security policies use an `is_admin()` function with `SECURITY DEFINER` and a fixed `search_path` to avoid recursive-policy slowdowns. If adding new RLS policies that need an admin check, reuse `is_admin()` rather than inlining a subquery against `profiles`.

### MCP server (`mcp-server/`)

Read-only stdio MCP server (`@modelcontextprotocol/sdk`) exposing 8 tools, all defined in `mcp-server/tools.js` and shared with the remote HTTP endpoint (`api/mcp.js`):

- **State**: `territorios_listar`, `territorios_buscar_por_id`, `territorios_vencidos` (assigned >4 months ago), `territorios_estadisticas`.
- **Time**: `territorios_actividad` — what was assigned/completed in a date range, with `evento` (asignados/completados/ambos) and `agrupar` (mes/zona/publicador/territorio). When `agrupar !== 'ninguno'` it deliberately omits the event list and returns only group totals, to keep the answer inside Haiku's token budget.
- **People**: `territorios_buscar_por_publicador` (everything about one publisher; `soloActuales` defaults to `true` only when no date filter is given), `publicadores_listar` (who exists, name resolution, ranking).
- **Staleness**: `territorios_sin_trabajar` — longest since last completion, free or assigned. Not the same as `territorios_vencidos`; the tool descriptions say so explicitly because the model conflates them otherwise.

`mcp-server/query.js` holds the shared query logic (event extraction from history, publisher indexing, pagination, output date formatting). Two invariants worth preserving: raw sheet strings never reach the output (`fechaNormalizada` emits ISO in `structuredContent`, `DD/MM/YYYY` in text, and says so explicitly when a date is unreadable), and publisher names are always cited via `nombreCanonico` so the same person isn't spelled two ways across answers.

It has its own `package.json`/`node_modules`, separate from the root app. Its only coupling to the main app is importing `fetchTerritoryData` from `src/lib/sheets.js` and the helpers in `src/lib/dates.js` — keep those stable, or update `mcp-server/data.js`, `query.js` and `tools.js` accordingly. Note the zod version skew: `mcp-server/node_modules` has zod 4 but `api/mcp.js` resolves zod 3 from the root; stick to schema APIs valid in both. All tools are annotated `readOnlyHint: true` and must stay read-only (the sheet itself is never written to by this codebase).

## Notes

- `temp_app.jsx`, `temp_app2.jsx`, and `vite.config.js.timestamp-*.mjs` are stray/generated files in the repo root — not part of the active app (entry point is `src/App.jsx` via `src/main.jsx`).
- Deployment is Vercel with SPA rewrites (`vercel.json`); the build step's KML→JSON conversion runs automatically on each deploy.
- The app and README are in Spanish (territory/zone/publisher domain terms: "territorio", "zona", "publicador", "vencido" = expired). Keep user-facing strings and MCP tool descriptions in Spanish for consistency with the existing codebase.

# Langfuse Observability for `ask-territorios`

**Date:** 2026-07-21
**Status:** Approved for planning

## Goal

Make the territory-question agent observable and tunable: see every request as a trace
(cost, latency, tool calls, errors), manage the system prompt without redeploying, and
measure answer quality against a fixed dataset before shipping prompt changes.

## Current architecture (what we are instrumenting)

- **UI** — `src/components/AskTerritorios.jsx`. Modal chat, multi-turn. Sends the full
  `messages` array to the edge function on every turn.
- **Agent** — `supabase/functions/ask-territorios/index.ts` (Deno). Verifies the caller's
  Supabase JWT and `profiles.is_active`, validates the message array, then makes a *single*
  Anthropic Messages API call via raw `fetch` (`claude-haiku-4-5`).
- **Tools** — the Anthropic **MCP connector** (`mcp_servers` + `mcp_toolset`) executes tools
  on Anthropic's servers against `api/mcp.js` on Vercel. There is **no manual tool-use loop**
  in our code.

Two constraints follow from this and shape the whole design:

1. **Tool timings are not observable.** Tool calls come back as `mcp_tool_use` /
   `mcp_tool_result` content blocks in Anthropic's response. We know the tool name,
   arguments and result, but not how long each took.
2. **Trace context cannot cross the MCP connector.** It forwards no custom headers. Tracing
   `api/mcp.js` would produce orphan traces correlated only by timestamp — **out of scope**.

## Scope

**In scope**

- Core tracing of the agent (traces, generation, reconstructed tool observations, cost,
  usage, userId, sessionId, errors).
- Prompt management: `SYSTEM_PROMPT` served from Langfuse with a local fallback.
- Offline evals: a committed dataset plus a local, on-demand experiment runner.

**Out of scope (decided, not deferred by accident)**

- User feedback scores (thumbs up/down). Not wanted.
- Tracing `api/mcp.js`. See constraint 2.
- CI eval gates. Local script only, run on demand.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Deployment | Langfuse Cloud EU (`https://cloud.langfuse.com`) | EU data residency; keys already exist |
| Transport | Hand-built **OTLP/HTTP JSON** to `/api/public/otel/v1/traces` | The Ingestion API is officially legacy; OTLP is the recommended path. JSON encoding is accepted, so this needs **zero dependencies** in the Deno edge function |
| Failure behavior | Fire-and-forget via `EdgeRuntime.waitUntil` | Langfuse being down or slow must never slow or break a user's answer |
| Eval target | Eval script replicates the agent call | Hitting the deployed function needs a Google-OAuth user JWT; replicating tests what evals should test (prompt, tool choice, answer quality) |
| Environments | `production` / `development` / `evaluation` | Keeps local testing and eval runs out of production metrics |

## Components

### 1. `supabase/functions/_shared/langfuse.ts` — tracing helper

Zero dependencies, Deno-native, ~120 lines.

- **IDs** — `crypto.getRandomValues` → 32-hex trace id, 16-hex span id.
- **Builder** — `createTrace({...})` returns an object with `span(name, type)` →
  `{ end(attrs) }`, accumulating spans in memory.
- **Flush** — `POST ${LANGFUSE_BASE_URL}/api/public/otel/v1/traces`, header
  `Authorization: Basic base64(pk:sk)`, OTLP/JSON body
  (`resourceSpans[].scopeSpans[].spans[]`).
- **Never throws.** Missing keys → silent no-op so local dev works without Langfuse. Any
  fetch or serialization failure → `console.warn` and swallow. A telemetry bug must never
  surface to a user.

Attribute names (verified against current Langfuse OTEL docs):

- Trace level: `langfuse.trace.name`, `langfuse.user.id`, `langfuse.session.id`,
  `langfuse.trace.input`, `langfuse.trace.output`, `langfuse.trace.tags`,
  `langfuse.trace.metadata.*`, `langfuse.environment`
- Observation level: `langfuse.observation.type`, `.input`, `.output`, `.model.name`,
  `.model.parameters`, `.usage_details`, `.cost_details`, `.prompt.name`, `.prompt.version`,
  `.level`, `.status_message`, `.metadata.*`

### 2. `supabase/functions/_shared/prompt.ts` — prompt management

- `GET ${LANGFUSE_BASE_URL}/api/public/v2/prompts/ask-territorios-system?label=production`,
  basic auth.
- Module-scope cache with a 60s TTL. Supabase edge instances are reused across requests, so
  most requests pay no network cost.
- **Fallback** is the current hardcoded `SYSTEM_PROMPT` literal, used whenever the fetch
  fails, times out, or keys are absent. Prompt behavior can never degrade because Langfuse is
  unavailable.
- Returns `{ text, name, version }`; `name`/`version` are `null` when the fallback was used,
  and the generation observation records that.

### 3. `ask-territorios/index.ts` — trace shape

Tracing begins **only after** auth and message validation pass. Rejected malformed requests
are not traced (noise).

```
trace  name=ask-territorios  userId=<supabase user.id>  sessionId=<conversation uuid>
│      input=<last user message>  output=<answer>  tags=[ask-territorios]
└─ span "handle-request"
   ├─ span "prompt-fetch"                    (emitted only when it hit the network)
   ├─ generation "anthropic-messages"
   │    model=claude-haiku-4-5
   │    model.parameters={max_tokens:1024}
   │    usage_details={input,output,cache_read}   cost_details
   │    prompt.name / prompt.version
   │    input=<messages>  output=<content blocks>
   │    metadata: stop_reason, tool_call_count
   │    ├─ tool "territorios_vencidos"   input=<args>  output=<result, truncated>
   │    └─ tool "territorios_listar"     …
```

- Tool observations are **reconstructed** from the response's `mcp_tool_use` /
  `mcp_tool_result` blocks. They carry zero duration and `metadata.reconstructed=true`.
  Honest zero beats a fabricated timing.
- Tool result payloads are truncated (cap ~4 KB per observation) to keep traces small.
- **Errors:** Anthropic non-OK → `level=ERROR` + `status_message` on the generation and the
  root span. `stop_reason === 'refusal'` → `level=WARNING`. Unexpected exceptions → `ERROR`
  on the root span, then flush.

### 4. `src/components/AskTerritorios.jsx` — session grouping

- Generate `crypto.randomUUID()` per conversation; reset it in `handleNewConversation`.
- Send it as `sessionId` in the request body.
- The server validates the UUID shape and **ignores anything else**. This value is
  client-supplied and therefore telemetry-only — it is never used for authorization.
  `userId` comes from the verified JWT, never from the client.

### 5. Prompt seeding — `scripts/langfuse-seed-prompt.mjs`

Idempotent script that pushes the current `SYSTEM_PROMPT` text to Langfuse as prompt
`ask-territorios-system` with label `production`. Makes the initial setup reproducible rather
than a manual UI step.

### 6. Evals — `scripts/eval/`

Its own `package.json` (following the existing `mcp-server/` pattern) so `@langfuse/client`
never enters the Vite app's dependency tree.

- **`dataset.json`** — ~20 Spanish items, each `{ input, expectedOutput, metadata.category }`.
  Categories: territory-id lookup, expired territories, zone filter, publisher search,
  assignment history, **nonexistent territory** (must say it does not exist, must not invent),
  **out-of-scope** (must decline).
- **`seed-dataset.mjs`** — creates/updates the Langfuse dataset `ask-territorios-v1`.
- **`run-experiment.mjs`** — `dataset.runExperiment({ name, task, evaluators })`,
  `environment: 'evaluation'`.
  - The **task** replicates the agent's Anthropic call: same model, same `mcp_servers` /
    `mcp_toolset` config, and it **fetches the system prompt from Langfuse** so prompt changes
    are actually what is being measured.
  - **Known tradeoff:** `MODEL` and `max_tokens` are duplicated between the edge function and
    this script and can drift. Accepted; noted in a comment in both files.
- **Evaluators (3):**
  - `accuracy` — LLM-as-judge comparing output against `expectedOutput`, returns 0–1 plus a
    comment.
  - `used-tools` — deterministic: did the response contain a tool call when the category
    requires one, and *no* tool call for out-of-scope items.
  - `spanish` — deterministic check that the answer is in Spanish.

## Configuration

Environment variables, set as Supabase edge function secrets and in a gitignored local
`.env` for the scripts. `.env` is already in `.gitignore`.

| Variable | Used by |
|---|---|
| `LANGFUSE_PUBLIC_KEY` | edge function, scripts |
| `LANGFUSE_SECRET_KEY` | edge function, scripts |
| `LANGFUSE_BASE_URL` | edge function, scripts (`https://cloud.langfuse.com`) |
| `LANGFUSE_ENVIRONMENT` | edge function (`production` / `development`) |

Key values are set by the repo owner directly; they are never pasted into a chat or
committed.

## Verification

The repo has no test suite, so verification is explicit and manual.

1. **Spike first (blocking).** Hand-build one OTLP/JSON span, POST it to Langfuse, confirm it
   renders in the UI. This also determines whether `langfuse.observation.type="tool"` is
   supported on the current instance — if not, tool observations fall back to `"span"`.
   Every other component depends on this wire format, so it is verified before anything else
   is written.
2. **Smoke test.** Ask a real question in the chat modal; confirm exactly one trace appears
   with the correct userId, sessionId, cost, and one tool observation per tool call.
3. **Failure test.** Set an invalid Langfuse secret key; confirm the chat still answers
   normally and the failure is only a `console.warn`.
4. **Prompt fallback test.** Delete the `production` label in Langfuse; confirm the agent
   still answers using the hardcoded fallback.
5. **Eval run.** `node scripts/eval/run-experiment.mjs` completes and the experiment appears
   in Langfuse with scores for all three evaluators.

## Risks

| Risk | Mitigation |
|---|---|
| Hand-built OTLP/JSON is subtly wrong | Spike task 1 verifies the exact wire format before anything is built on it |
| `observation.type="tool"` unsupported | Spike determines this; documented fallback to `"span"` |
| Prompt fetch adds latency to first request per instance | 60s module-scope cache + short fetch timeout + local fallback |
| Eval script drifts from the edge function | Prompt is shared via Langfuse; the remaining duplication (model, max_tokens) is documented in both files |
| Trace payloads grow large | Tool results truncated to ~4 KB per observation |

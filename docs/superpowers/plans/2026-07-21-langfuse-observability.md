# Langfuse Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument the `ask-territorios` agent with Langfuse — OTLP tracing from the Deno edge function, a Langfuse-managed system prompt with a local fallback, and a local offline eval harness.

**Architecture:** The Deno edge function builds OTLP/HTTP JSON by hand (zero dependencies) and POSTs it to Langfuse Cloud EU after the user's response is already sent, via `EdgeRuntime.waitUntil`. The system prompt is fetched from Langfuse with a module-scope cache and a hardcoded fallback. Evals live in an isolated Node package under `scripts/eval/` and replicate the agent's Anthropic call rather than hitting the deployed function.

**Tech Stack:** Deno (Supabase Edge Functions), React 18 + Vite, Node ≥ 20 (scripts), Langfuse Cloud EU, `@langfuse/client` ≥ 5.6.0, Anthropic Messages API with the MCP connector.

**Spec:** `docs/superpowers/specs/2026-07-21-langfuse-observability-design.md`

## Global Constraints

- **Langfuse host:** `https://cloud.langfuse.com` (EU). Never hardcode it — always read `LANGFUSE_BASE_URL`.
- **Zero dependencies in the edge function.** `supabase/functions/**` must not import any npm/jsr package for Langfuse. Hand-built OTLP/JSON only. Node-only scripts may use packages.
- **Telemetry must never break or slow a user request.** Every Langfuse call is wrapped in try/catch, logged with `console.warn`, and swallowed. Flush happens via `EdgeRuntime.waitUntil` after the response is returned.
- **Missing keys = silent no-op.** If `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY` is absent, all tracing and prompt-fetching short-circuit and the app behaves exactly as it does today. Local dev must work without Langfuse.
- **No personal data in git.** `scripts/eval/dataset.json` must never contain real publisher names. Use territory IDs and zone names only.
- **No secrets in git.** `.env` is already in `.gitignore`. Never write key values into any committed file, and never print a secret key to stdout.
- **User-facing strings stay in Spanish.** Code comments in this repo are Spanish in the edge function and mixed elsewhere; match the file you are editing.
- **Real zone names (for eval fixtures):** `Les Corts Norte`, `Les Corts Sur`, `Pedralbes`, `Sants`, `Sarrià`, `Sin zona`. Territory IDs are numeric, 1–181.
- **Model under test:** `claude-haiku-4-5`. **Judge model:** `claude-sonnet-5`.
- **Prompt name in Langfuse:** `ask-territorios-system`, label `production`.
- **Dataset name in Langfuse:** `ask-territorios-v1`.

## Environment variables

Set these as Supabase edge function secrets *and* in a local gitignored `.env` at the repo root for the scripts. The repo owner sets the values; no task should ever ask for them in chat.

| Variable | Value | Used by |
|---|---|---|
| `LANGFUSE_PUBLIC_KEY` | `pk-lf-…` | edge function, scripts |
| `LANGFUSE_SECRET_KEY` | `sk-lf-…` | edge function, scripts |
| `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` | edge function, scripts |
| `LANGFUSE_ENVIRONMENT` | `production` (deployed) / `development` (local) | edge function |
| `ANTHROPIC_API_KEY` | existing | edge function, eval scripts |
| `MCP_SERVER_URL` | existing | edge function, eval scripts |
| `MCP_SHARED_SECRET` | existing | edge function, eval scripts |

## File Structure

| File | Responsibility |
|---|---|
| `scripts/langfuse-otel-spike.mjs` | **New.** Throwaway-but-kept dev utility: posts one hand-built OTLP trace to Langfuse to prove the wire format. Also the debugging tool when traces stop appearing. |
| `supabase/functions/_shared/langfuse.ts` | **New.** The tracing helper. Builds OTLP/JSON, generates IDs, flushes. No knowledge of territories or Anthropic. |
| `supabase/functions/_shared/prompt.ts` | **New.** Fetches + caches the system prompt, falls back to a local literal. |
| `scripts/langfuse-seed-prompt.mjs` | **New.** Idempotently pushes the system prompt text to Langfuse. |
| `supabase/functions/ask-territorios/index.ts` | **Modify.** Wire in tracing and the managed prompt. Accept an optional `sessionId`. |
| `src/components/AskTerritorios.jsx` | **Modify.** Generate a conversation UUID, reset it on "Nueva conversación", send it as `sessionId`. |
| `scripts/eval/package.json` | **New.** Isolated Node package so `@langfuse/client` stays out of the Vite app's dependency tree (mirrors the existing `mcp-server/` pattern). |
| `scripts/eval/dataset.json` | **New.** ~20 Spanish eval items. Rubric-based expected outputs, no personal data. |
| `scripts/eval/agent.mjs` | **New.** Replicates the edge function's Anthropic + MCP call. Shared by the runner. |
| `scripts/eval/seed-dataset.mjs` | **New.** Pushes `dataset.json` into the Langfuse dataset via REST. |
| `scripts/eval/evaluators.mjs` | **New.** The three evaluators. |
| `scripts/eval/run-experiment.mjs` | **New.** Runs the experiment and prints results. |
| `CLAUDE.md` | **Modify.** Document the observability layer for future sessions. |

## Important design note: rubric-based expected outputs

Territory data is a **live Google Sheet**. Counts and assignments change weekly. A dataset with frozen literal answers (`"Hay 2 territorios vencidos"`) would start failing for the wrong reason within days.

Therefore `expectedOutput` in `dataset.json` is a **grading rubric written in Spanish**, describing what a correct answer must do — not a literal answer. The LLM judge grades the actual answer against that rubric. Deterministic evaluators cover tool usage and language.

---

### Task 1: Verify the OTLP wire format (spike — blocking)

Everything else depends on the exact JSON Langfuse accepts. Prove it before writing the helper.

**Files:**
- Create: `scripts/langfuse-otel-spike.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: a confirmed OTLP/JSON payload shape and a confirmed answer to "is `langfuse.observation.type = "tool"` supported?". Task 2 copies the payload shape verbatim.

- [ ] **Step 1: Confirm the local `.env` has Langfuse keys**

Create `.env` at the repo root if it does not exist (it is already gitignored). It must contain:

```
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

Run: `node --env-file=.env -e "console.log('pk set:', !!process.env.LANGFUSE_PUBLIC_KEY, 'sk set:', !!process.env.LANGFUSE_SECRET_KEY, 'url:', process.env.LANGFUSE_BASE_URL)"`

Expected: `pk set: true sk set: true url: https://cloud.langfuse.com`

If it prints `false`, stop and tell the user to populate `.env`. Do not ask them to paste key values into chat.

- [ ] **Step 2: Write the spike script**

Create `scripts/langfuse-otel-spike.mjs`:

```js
// Dev utility: posts one hand-built OTLP/JSON trace to Langfuse to verify the
// wire format used by supabase/functions/_shared/langfuse.ts. Also the first
// thing to run when traces stop showing up in the Langfuse UI.
//
// Usage: node --env-file=.env scripts/langfuse-otel-spike.mjs

const BASE_URL = process.env.LANGFUSE_BASE_URL;
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

if (!BASE_URL || !PUBLIC_KEY || !SECRET_KEY) {
  console.error('Missing LANGFUSE_BASE_URL / LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY');
  process.exit(1);
}

const hex = (bytes) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const traceId = hex(16); // 32 hex chars
const rootId = hex(8);   // 16 hex chars
const genId = hex(8);
const toolId = hex(8);

const now = Date.now();
const nano = (ms) => String(BigInt(Math.round(ms)) * 1_000_000n);

const attr = (key, value) => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return { key, value: { intValue: String(value) } };
  }
  if (typeof value === 'number') return { key, value: { doubleValue: value } };
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  return { key, value: { stringValue: String(value) } };
};

const span = ({ spanId, parentSpanId, name, start, end, attributes }) => ({
  traceId,
  spanId,
  ...(parentSpanId ? { parentSpanId } : {}),
  name,
  kind: 1,
  startTimeUnixNano: nano(start),
  endTimeUnixNano: nano(end),
  attributes,
});

const body = {
  resourceSpans: [
    {
      resource: { attributes: [attr('service.name', 'ask-territorios')] },
      scopeSpans: [
        {
          scope: { name: 'mapa-territorios-spike' },
          spans: [
            span({
              spanId: rootId,
              name: 'handle-request',
              start: now - 1500,
              end: now,
              attributes: [
                attr('langfuse.trace.name', 'ask-territorios'),
                attr('langfuse.user.id', 'spike-user'),
                attr('langfuse.session.id', '00000000-0000-4000-8000-000000000000'),
                attr('langfuse.trace.input', '¿Qué territorios están vencidos?'),
                attr('langfuse.trace.output', 'Hay 2 territorios vencidos en Sarrià.'),
                attr('langfuse.trace.tags', JSON.stringify(['ask-territorios', 'spike'])),
                attr('langfuse.environment', 'development'),
                attr('langfuse.observation.type', 'span'),
              ],
            }),
            span({
              spanId: genId,
              parentSpanId: rootId,
              name: 'anthropic-messages',
              start: now - 1400,
              end: now - 100,
              attributes: [
                attr('langfuse.observation.type', 'generation'),
                attr('langfuse.observation.model.name', 'claude-haiku-4-5'),
                attr('langfuse.observation.model.parameters', JSON.stringify({ max_tokens: 1024 })),
                attr('langfuse.observation.input', JSON.stringify([{ role: 'user', content: 'hola' }])),
                attr('langfuse.observation.output', 'Hay 2 territorios vencidos en Sarrià.'),
                attr('langfuse.observation.usage_details', JSON.stringify({ input: 1200, output: 80 })),
                attr('langfuse.observation.prompt.name', 'ask-territorios-system'),
                attr('langfuse.observation.prompt.version', 1),
              ],
            }),
            span({
              spanId: toolId,
              parentSpanId: genId,
              name: 'territorios_vencidos',
              start: now - 900,
              end: now - 900,
              attributes: [
                // The point of the spike: is "tool" accepted as an observation type?
                attr('langfuse.observation.type', 'tool'),
                attr('langfuse.observation.input', JSON.stringify({ limit: 10 })),
                attr('langfuse.observation.output', JSON.stringify({ vencidos: 2 })),
                attr('langfuse.observation.metadata.reconstructed', 'true'),
              ],
            }),
          ],
        },
      ],
    },
  ],
};

const auth = Buffer.from(`${PUBLIC_KEY}:${SECRET_KEY}`).toString('base64');

const res = await fetch(`${BASE_URL}/api/public/otel/v1/traces`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Basic ${auth}`,
  },
  body: JSON.stringify(body),
});

console.log('status:', res.status);
console.log('body:', await res.text());
console.log('traceId:', traceId);
console.log(`open: ${BASE_URL} -> Tracing -> Traces, look for trace id ${traceId}`);
```

- [ ] **Step 3: Run the spike**

Run: `node --env-file=.env scripts/langfuse-otel-spike.mjs`

Expected: `status: 200` (or `202`). If it is `401`, the keys are wrong. If it is `400`, print the response body — it names the offending field; fix the payload and rerun until it succeeds.

- [ ] **Step 4: Confirm the trace renders correctly in the Langfuse UI**

Open `https://cloud.langfuse.com`, go to Tracing → Traces, find the printed `traceId`. Verify **all** of:

- The trace name is `ask-territorios`, user is `spike-user`, session is the zero UUID.
- The generation shows model `claude-haiku-4-5` and non-zero token usage, and a cost is calculated.
- The nested observation `territorios_vencidos` appears under the generation.
- Note whether that nested observation is typed **tool** or fell back to a plain span.

Record the outcome in a comment at the top of the spike file:

```js
// VERIFIED <date>: status 200. observation.type "tool" -> <supported | NOT supported, renders as span>
```

If `tool` is **not** supported, every later task must use `'span'` as the observation type for tool calls and put the tool name in `langfuse.observation.metadata.tool_name`. Note that decision in the same comment.

- [ ] **Step 5: Commit**

```bash
git add scripts/langfuse-otel-spike.mjs
git commit -m "chore: add Langfuse OTLP wire-format spike script"
```

---

### Task 2: Tracing helper for the edge function

**Files:**
- Create: `supabase/functions/_shared/langfuse.ts`

**Interfaces:**
- Consumes: the verified payload shape from Task 1.
- Produces:
  - `createTrace(opts: TraceOptions): Trace`
  - `TraceOptions = { name: string; userId?: string; sessionId?: string; tags?: string[]; environment?: string }`
  - `Trace = { traceId: string; rootSpanId: string; startSpan(name: string, type: ObservationType, parentSpanId?: string): Span; setTrace(attrs: { input?: unknown; output?: unknown; metadata?: Record<string, unknown> }): void; setError(message: string): void; flush(): Promise<void>; }`
  - `Span = { spanId: string; end(attrs?: SpanAttrs): void }`
  - `SpanAttrs = { input?: unknown; output?: unknown; model?: string; modelParameters?: Record<string, unknown>; usage?: Record<string, number>; promptName?: string | null; promptVersion?: number | null; metadata?: Record<string, unknown>; level?: 'DEFAULT' | 'WARNING' | 'ERROR'; statusMessage?: string }`
  - `ObservationType = 'span' | 'generation' | 'tool' | 'event'`
- Task 4 imports `createTrace` and nothing else.

- [ ] **Step 1: Write the helper**

Create `supabase/functions/_shared/langfuse.ts`:

```ts
// Envío de trazas a Langfuse mediante OTLP/HTTP con codificación JSON.
// Sin dependencias a propósito: esta función corre en el edge runtime de Deno
// y la telemetría nunca debe añadir peso ni puntos de fallo a la respuesta.
//
// Regla invariable: NADA aquí puede lanzar una excepción hacia el llamante.
// Si Langfuse falla, el usuario no debe enterarse.

export type ObservationType = 'span' | 'generation' | 'tool' | 'event';

export type SpanAttrs = {
    input?: unknown;
    output?: unknown;
    model?: string;
    modelParameters?: Record<string, unknown>;
    usage?: Record<string, number>;
    promptName?: string | null;
    promptVersion?: number | null;
    metadata?: Record<string, unknown>;
    level?: 'DEFAULT' | 'WARNING' | 'ERROR';
    statusMessage?: string;
};

export type TraceOptions = {
    name: string;
    userId?: string;
    sessionId?: string;
    tags?: string[];
    environment?: string;
};

export type Span = {
    spanId: string;
    end(attrs?: SpanAttrs): void;
};

type OtlpAttribute = { key: string; value: Record<string, unknown> };

type PendingSpan = {
    spanId: string;
    parentSpanId?: string;
    name: string;
    startMs: number;
    endMs: number;
    attributes: OtlpAttribute[];
};

// Los payloads de las tools pueden ser grandes; recortamos para no inflar las trazas.
const MAX_VALUE_CHARS = 4000;
const FLUSH_TIMEOUT_MS = 3000;

function hex(bytes: number): string {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function nano(ms: number): string {
    return String(BigInt(Math.round(ms)) * 1_000_000n);
}

function stringify(value: unknown): string {
    let text: string;
    if (typeof value === 'string') {
        text = value;
    } else {
        try {
            text = JSON.stringify(value) ?? '';
        } catch {
            text = '[unserializable]';
        }
    }
    return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…[truncated]` : text;
}

function attr(key: string, value: unknown): OtlpAttribute {
    if (typeof value === 'number' && Number.isInteger(value)) {
        return { key, value: { intValue: String(value) } };
    }
    if (typeof value === 'number') return { key, value: { doubleValue: value } };
    if (typeof value === 'boolean') return { key, value: { boolValue: value } };
    return { key, value: { stringValue: stringify(value) } };
}

function observationAttrs(type: ObservationType, a: SpanAttrs): OtlpAttribute[] {
    const out: OtlpAttribute[] = [attr('langfuse.observation.type', type)];
    if (a.input !== undefined) out.push(attr('langfuse.observation.input', a.input));
    if (a.output !== undefined) out.push(attr('langfuse.observation.output', a.output));
    if (a.model) out.push(attr('langfuse.observation.model.name', a.model));
    if (a.modelParameters) {
        out.push(attr('langfuse.observation.model.parameters', a.modelParameters));
    }
    if (a.usage) out.push(attr('langfuse.observation.usage_details', a.usage));
    if (a.promptName) out.push(attr('langfuse.observation.prompt.name', a.promptName));
    if (typeof a.promptVersion === 'number') {
        out.push(attr('langfuse.observation.prompt.version', a.promptVersion));
    }
    if (a.level) out.push(attr('langfuse.observation.level', a.level));
    if (a.statusMessage) out.push(attr('langfuse.observation.status_message', a.statusMessage));
    for (const [k, v] of Object.entries(a.metadata ?? {})) {
        out.push(attr(`langfuse.observation.metadata.${k}`, v));
    }
    return out;
}

export function createTrace(opts: TraceOptions) {
    const baseUrl = Deno.env.get('LANGFUSE_BASE_URL');
    const publicKey = Deno.env.get('LANGFUSE_PUBLIC_KEY');
    const secretKey = Deno.env.get('LANGFUSE_SECRET_KEY');
    const enabled = Boolean(baseUrl && publicKey && secretKey);

    const traceId = hex(16);
    const rootSpanId = hex(8);
    const startedAt = Date.now();
    const spans: PendingSpan[] = [];

    const traceAttrs: OtlpAttribute[] = [
        attr('langfuse.trace.name', opts.name),
        attr('langfuse.observation.type', 'span'),
    ];
    if (opts.userId) traceAttrs.push(attr('langfuse.user.id', opts.userId));
    if (opts.sessionId) traceAttrs.push(attr('langfuse.session.id', opts.sessionId));
    if (opts.tags?.length) traceAttrs.push(attr('langfuse.trace.tags', opts.tags));
    if (opts.environment) traceAttrs.push(attr('langfuse.environment', opts.environment));

    function startSpan(name: string, type: ObservationType, parentSpanId?: string): Span {
        const spanId = hex(8);
        const spanStart = Date.now();
        let ended = false;
        return {
            spanId,
            end(a: SpanAttrs = {}) {
                if (ended) return;
                ended = true;
                try {
                    spans.push({
                        spanId,
                        parentSpanId: parentSpanId ?? rootSpanId,
                        name,
                        startMs: spanStart,
                        endMs: Date.now(),
                        attributes: observationAttrs(type, a),
                    });
                } catch (err) {
                    console.warn('[langfuse] failed to record span', err);
                }
            },
        };
    }

    return {
        traceId,
        rootSpanId,
        startSpan,

        // Añade una observación con duración cero, para tool calls reconstruidas
        // a partir de la respuesta de Anthropic (no medimos su latencia real).
        addPointObservation(
            name: string,
            type: ObservationType,
            attrs: SpanAttrs,
            parentSpanId?: string,
        ) {
            try {
                const at = Date.now();
                spans.push({
                    spanId: hex(8),
                    parentSpanId: parentSpanId ?? rootSpanId,
                    name,
                    startMs: at,
                    endMs: at,
                    attributes: observationAttrs(type, attrs),
                });
            } catch (err) {
                console.warn('[langfuse] failed to record observation', err);
            }
        },

        setTrace(a: { input?: unknown; output?: unknown; metadata?: Record<string, unknown> }) {
            try {
                if (a.input !== undefined) traceAttrs.push(attr('langfuse.trace.input', a.input));
                if (a.output !== undefined) traceAttrs.push(attr('langfuse.trace.output', a.output));
                for (const [k, v] of Object.entries(a.metadata ?? {})) {
                    traceAttrs.push(attr(`langfuse.trace.metadata.${k}`, v));
                }
            } catch (err) {
                console.warn('[langfuse] failed to set trace attributes', err);
            }
        },

        setError(message: string) {
            traceAttrs.push(attr('langfuse.observation.level', 'ERROR'));
            traceAttrs.push(attr('langfuse.observation.status_message', message));
        },

        async flush(): Promise<void> {
            if (!enabled) return;
            try {
                const endedAt = Date.now();
                const root: PendingSpan = {
                    spanId: rootSpanId,
                    name: opts.name,
                    startMs: startedAt,
                    endMs: endedAt,
                    attributes: traceAttrs,
                };

                const body = {
                    resourceSpans: [{
                        resource: { attributes: [attr('service.name', 'ask-territorios')] },
                        scopeSpans: [{
                            scope: { name: 'mapa-territorios' },
                            spans: [root, ...spans].map((s) => ({
                                traceId,
                                spanId: s.spanId,
                                ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
                                name: s.name,
                                kind: 1,
                                startTimeUnixNano: nano(s.startMs),
                                endTimeUnixNano: nano(s.endMs),
                                attributes: s.attributes,
                            })),
                        }],
                    }],
                };

                const auth = btoa(`${publicKey}:${secretKey}`);
                const res = await fetch(`${baseUrl}/api/public/otel/v1/traces`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Basic ${auth}`,
                    },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(FLUSH_TIMEOUT_MS),
                });

                if (!res.ok) {
                    console.warn('[langfuse] ingestion rejected', res.status, await res.text());
                }
            } catch (err) {
                console.warn('[langfuse] flush failed', err);
            }
        },
    };
}

export type Trace = ReturnType<typeof createTrace>;
```

- [ ] **Step 2: Apply the Task 1 finding about the `tool` observation type**

If Task 1's spike recorded that `tool` is **not** supported, no change is needed here (the type is a parameter), but note it in a comment above `ObservationType` so Task 4's implementer passes `'span'` instead:

```ts
// NOTA (verificado en Task 1): 'tool' <sí | no> está soportado por esta instancia.
```

- [ ] **Step 3: Type-check the file**

Run: `npx --yes deno@2 check supabase/functions/_shared/langfuse.ts`

Expected: `Check file:///…/langfuse.ts` and no errors.

If `deno` cannot be installed in this environment, skip this step and note it — Task 4's deploy will surface type errors instead.

- [ ] **Step 4: Smoke-test the helper against real Langfuse**

Create a temporary file `supabase/functions/_shared/langfuse.smoke.ts`:

```ts
import { createTrace } from './langfuse.ts';

const trace = createTrace({
    name: 'ask-territorios',
    userId: 'smoke-user',
    sessionId: '00000000-0000-4000-8000-000000000001',
    tags: ['ask-territorios', 'smoke'],
    environment: 'development',
});

const gen = trace.startSpan('anthropic-messages', 'generation');
await new Promise((r) => setTimeout(r, 50));
gen.end({
    model: 'claude-haiku-4-5',
    modelParameters: { max_tokens: 1024 },
    input: [{ role: 'user', content: 'prueba' }],
    output: 'respuesta de prueba',
    usage: { input: 100, output: 20 },
});
trace.addPointObservation(
    'territorios_estadisticas',
    'tool',
    { input: {}, output: { total: 181 }, metadata: { reconstructed: true } },
    gen.spanId,
);
trace.setTrace({ input: 'prueba', output: 'respuesta de prueba' });
await trace.flush();
console.log('flushed trace', trace.traceId);
```

Run: `npx --yes deno@2 run --allow-net --allow-env --env-file=.env supabase/functions/_shared/langfuse.smoke.ts`

Expected: prints `flushed trace <id>` with **no** `[langfuse]` warning. Confirm the trace appears in the Langfuse UI with the generation and the nested tool observation.

Then delete the smoke file: `rm supabase/functions/_shared/langfuse.smoke.ts`

- [ ] **Step 5: Verify the disabled path**

Run the same command **without** `--env-file=.env`:

Run: `npx --yes deno@2 run --allow-net --allow-env supabase/functions/_shared/langfuse.smoke.ts`

Expected: prints `flushed trace <id>`, no warning, no network call, no crash. (Recreate the smoke file for this step if you already deleted it, then delete it again.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/langfuse.ts
git commit -m "feat: add dependency-free Langfuse OTLP tracing helper for edge functions"
```

---

### Task 3: Managed system prompt with local fallback

**Files:**
- Create: `supabase/functions/_shared/prompt.ts`
- Create: `scripts/langfuse-seed-prompt.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `FALLBACK_SYSTEM_PROMPT: string` — the exact literal currently in `ask-territorios/index.ts`
  - `getSystemPrompt(): Promise<{ text: string; name: string | null; version: number | null; fetched: boolean }>` — `fetched` is `true` only when this call performed a network request (so Task 4 knows whether to emit a `prompt-fetch` span). `name`/`version` are `null` when the fallback was used.

- [ ] **Step 1: Write the prompt module**

Create `supabase/functions/_shared/prompt.ts`:

```ts
// El system prompt se gestiona en Langfuse para poder ajustarlo sin redesplegar.
// Si Langfuse no responde, usamos la copia local: el agente nunca debe degradarse
// porque la herramienta de observabilidad esté caída.

export const PROMPT_NAME = 'ask-territorios-system';

export const FALLBACK_SYSTEM_PROMPT =
    'Respondes preguntas sobre el estado de los territorios de predicación ' +
    '(libre/asignado, vencidos, zonas, historial) usando exclusivamente las tools disponibles. ' +
    'Responde siempre en español, de forma breve y concreta. No inventes datos que no obtengas de las tools.';

const CACHE_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 2000;

type CachedPrompt = { text: string; name: string; version: number };

// Las instancias del edge runtime se reutilizan entre peticiones, así que este
// caché a nivel de módulo evita una llamada de red en la mayoría de peticiones.
let cache: CachedPrompt | null = null;
let cachedAt = 0;

export async function getSystemPrompt(): Promise<{
    text: string;
    name: string | null;
    version: number | null;
    fetched: boolean;
}> {
    const now = Date.now();
    if (cache && now - cachedAt < CACHE_TTL_MS) {
        return { text: cache.text, name: cache.name, version: cache.version, fetched: false };
    }

    const baseUrl = Deno.env.get('LANGFUSE_BASE_URL');
    const publicKey = Deno.env.get('LANGFUSE_PUBLIC_KEY');
    const secretKey = Deno.env.get('LANGFUSE_SECRET_KEY');

    if (!baseUrl || !publicKey || !secretKey) {
        return { text: FALLBACK_SYSTEM_PROMPT, name: null, version: null, fetched: false };
    }

    try {
        const url = `${baseUrl}/api/public/v2/prompts/${PROMPT_NAME}?label=production`;
        const res = await fetch(url, {
            headers: { Authorization: `Basic ${btoa(`${publicKey}:${secretKey}`)}` },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!res.ok) {
            console.warn('[langfuse] prompt fetch failed', res.status);
            return { text: FALLBACK_SYSTEM_PROMPT, name: null, version: null, fetched: true };
        }

        const data = await res.json();
        // Los prompts de tipo "text" devuelven `prompt` como string.
        const text = typeof data?.prompt === 'string' ? data.prompt : null;
        const version = typeof data?.version === 'number' ? data.version : null;

        if (!text || version === null) {
            console.warn('[langfuse] unexpected prompt payload shape');
            return { text: FALLBACK_SYSTEM_PROMPT, name: null, version: null, fetched: true };
        }

        cache = { text, name: PROMPT_NAME, version };
        cachedAt = now;
        return { text, name: PROMPT_NAME, version, fetched: true };
    } catch (err) {
        console.warn('[langfuse] prompt fetch error', err);
        // Si teníamos una copia cacheada aunque esté caducada, es mejor que el fallback.
        if (cache) {
            return { text: cache.text, name: cache.name, version: cache.version, fetched: true };
        }
        return { text: FALLBACK_SYSTEM_PROMPT, name: null, version: null, fetched: true };
    }
}
```

- [ ] **Step 2: Write the seeding script**

Create `scripts/langfuse-seed-prompt.mjs`:

```js
// Sube el system prompt de ask-territorios a Langfuse con la etiqueta "production".
// Idempotente: Langfuse versiona el prompt, así que ejecutarlo dos veces con el
// mismo texto solo crea una versión nueva idéntica.
//
// Usage: node --env-file=.env scripts/langfuse-seed-prompt.mjs

const BASE_URL = process.env.LANGFUSE_BASE_URL;
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

if (!BASE_URL || !PUBLIC_KEY || !SECRET_KEY) {
  console.error('Missing LANGFUSE_BASE_URL / LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY');
  process.exit(1);
}

// Debe coincidir con FALLBACK_SYSTEM_PROMPT en
// supabase/functions/_shared/prompt.ts
const PROMPT_TEXT =
  'Respondes preguntas sobre el estado de los territorios de predicación ' +
  '(libre/asignado, vencidos, zonas, historial) usando exclusivamente las tools disponibles. ' +
  'Responde siempre en español, de forma breve y concreta. No inventes datos que no obtengas de las tools.';

const auth = Buffer.from(`${PUBLIC_KEY}:${SECRET_KEY}`).toString('base64');

const res = await fetch(`${BASE_URL}/api/public/v2/prompts`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Basic ${auth}`,
  },
  body: JSON.stringify({
    name: 'ask-territorios-system',
    type: 'text',
    prompt: PROMPT_TEXT,
    labels: ['production'],
  }),
});

console.log('status:', res.status);
const text = await res.text();
console.log('body:', text);
if (!res.ok) process.exit(1);
```

- [ ] **Step 3: Seed the prompt**

Run: `node --env-file=.env scripts/langfuse-seed-prompt.mjs`

Expected: `status: 201` and a JSON body containing `"name":"ask-territorios-system"` and `"version":1`.

If it returns `400`, print the body — it names the wrong field. Check the current schema at `https://langfuse.com/docs/prompt-management/get-started.md` and fix.

- [ ] **Step 4: Verify the prompt fetch path**

Run: `curl -s -u "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" "$LANGFUSE_BASE_URL/api/public/v2/prompts/ask-territorios-system?label=production"`

(Load the env first with `set -a; . ./.env; set +a` in bash.)

Expected: JSON with `"prompt": "Respondes preguntas sobre el estado…"` and a numeric `"version"`.

Confirm the field holding the text is named `prompt` — if the payload uses a different field name, update the parsing in `prompt.ts` Step 1 to match.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/prompt.ts scripts/langfuse-seed-prompt.mjs
git commit -m "feat: manage ask-territorios system prompt in Langfuse with local fallback"
```

---

### Task 4: Instrument the edge function

**Files:**
- Modify: `supabase/functions/ask-territorios/index.ts`

**Interfaces:**
- Consumes: `createTrace` from `../_shared/langfuse.ts`; `getSystemPrompt`, `FALLBACK_SYSTEM_PROMPT` from `../_shared/prompt.ts`.
- Produces: the function now accepts an optional `sessionId` string in the request body. Task 5 sends it.

- [ ] **Step 1: Replace the imports and the prompt constant**

In `supabase/functions/ask-territorios/index.ts`, replace lines 1–18 (the imports through `SYSTEM_PROMPT`) with:

```ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createTrace } from "../_shared/langfuse.ts";
import { getSystemPrompt } from "../_shared/prompt.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Solo lectura: este modelo únicamente puede consultar el estado de los
// territorios a través de las tools del servidor MCP remoto (ver api/mcp.js).
const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 1024;
const MCP_BETA_HEADER = 'mcp-client-2025-11-20';
const MAX_MESSAGES = 20;
const MAX_TOTAL_CHARS = 12000;

// El sessionId sólo agrupa la conversación en Langfuse. Viene del cliente, así
// que se valida la forma y se descarta si no encaja: nunca se usa para autorizar.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ejecuta el flush de telemetría sin bloquear la respuesta al usuario.
function fireAndForget(promise: Promise<unknown>) {
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (runtime?.waitUntil) {
        runtime.waitUntil(promise);
    } else {
        promise.catch(() => { });
    }
}
```

> Note: `SYSTEM_PROMPT` is intentionally gone — the text now lives in `_shared/prompt.ts` as `FALLBACK_SYSTEM_PROMPT`.

- [ ] **Step 2: Read the `sessionId` out of the request body**

Find the line `const { messages } = await req.json();` and replace it with:

```ts
        const { messages, sessionId: rawSessionId } = await req.json();
        const sessionId = typeof rawSessionId === 'string' && UUID_RE.test(rawSessionId)
            ? rawSessionId
            : undefined;
```

- [ ] **Step 3: Start the trace once validation has passed**

Immediately **after** the `messages[messages.length - 1].role !== 'user'` validation block closes (i.e. just before `const anthropicApiKey = …`), insert:

```ts
        // A partir de aquí la petición es válida y vamos a gastar tokens, así que
        // merece la pena trazarla. Las peticiones mal formadas no se trazan.
        const trace = createTrace({
            name: 'ask-territorios',
            userId: user.id,
            sessionId,
            tags: ['ask-territorios'],
            environment: Deno.env.get('LANGFUSE_ENVIRONMENT') ?? 'production',
        });
        const lastUserMessage = messages[messages.length - 1].content.trim();
        trace.setTrace({
            input: lastUserMessage,
            metadata: { message_count: messages.length },
        });

        const promptSpan = trace.startSpan('prompt-fetch', 'span');
        const systemPrompt = await getSystemPrompt();
        if (systemPrompt.fetched) {
            promptSpan.end({
                output: { name: systemPrompt.name, version: systemPrompt.version },
                metadata: { fallback: systemPrompt.name === null },
            });
        }
```

> `promptSpan.end()` is deliberately skipped on a cache hit — no network happened, so there is nothing worth showing in the trace.

- [ ] **Step 4: Wrap the Anthropic call in a generation span**

Replace the whole block from `const anthropicResponse = await fetch(` through the closing `});` of that call with:

```ts
        const generation = trace.startSpan('anthropic-messages', 'generation');
        const anthropicMessages = messages.map((m: { role: string; content: string }) => ({
            role: m.role,
            content: m.content.trim(),
        }));

        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicApiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': MCP_BETA_HEADER,
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: MAX_TOKENS,
                system: systemPrompt.text,
                mcp_servers: [{
                    type: 'url',
                    name: 'territorios',
                    url: mcpServerUrl,
                    authorization_token: mcpSharedSecret,
                }],
                tools: [{ type: 'mcp_toolset', mcp_server_name: 'territorios' }],
                messages: anthropicMessages,
            }),
        });
```

- [ ] **Step 5: Trace the Anthropic error path**

Replace the `if (!anthropicResponse.ok) { … }` block with:

```ts
        if (!anthropicResponse.ok) {
            const errText = await anthropicResponse.text();
            console.error('Anthropic API error:', anthropicResponse.status, errText);
            generation.end({
                model: MODEL,
                input: anthropicMessages,
                level: 'ERROR',
                statusMessage: `Anthropic ${anthropicResponse.status}: ${errText}`,
            });
            trace.setError(`Anthropic ${anthropicResponse.status}`);
            fireAndForget(trace.flush());
            return new Response(JSON.stringify({ error: 'Failed to get an answer' }), {
                status: 502,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
```

- [ ] **Step 6: End the generation, reconstruct tool observations, and trace the refusal path**

Replace everything from `const result = await anthropicResponse.json();` through the successful `return new Response(JSON.stringify({ answer }), …);` with:

```ts
        const result = await anthropicResponse.json();
        const contentBlocks: Array<Record<string, unknown>> = result.content ?? [];

        const answer = contentBlocks
            .filter((block) => block.type === 'text')
            .map((block) => block.text as string)
            .join('\n')
            .trim();

        const toolUses = contentBlocks.filter((b) => b.type === 'mcp_tool_use');

        generation.end({
            model: MODEL,
            modelParameters: { max_tokens: MAX_TOKENS },
            input: anthropicMessages,
            output: answer || contentBlocks,
            usage: {
                input: result.usage?.input_tokens ?? 0,
                output: result.usage?.output_tokens ?? 0,
                cache_read: result.usage?.cache_read_input_tokens ?? 0,
            },
            promptName: systemPrompt.name,
            promptVersion: systemPrompt.version,
            metadata: {
                stop_reason: result.stop_reason ?? 'unknown',
                tool_call_count: toolUses.length,
            },
            level: result.stop_reason === 'refusal' ? 'WARNING' : 'DEFAULT',
        });

        // Anthropic ejecuta las tools en su lado, así que sólo podemos reconstruir
        // las llamadas a partir de los bloques de la respuesta: sabemos nombre,
        // argumentos y resultado, pero no cuánto tardó cada una. Por eso duración 0.
        for (const use of toolUses) {
            const resultBlock = contentBlocks.find(
                (b) => b.type === 'mcp_tool_result' && b.tool_use_id === use.id,
            );
            trace.addPointObservation(
                (use.name as string) ?? 'mcp_tool',
                'tool',
                {
                    input: use.input,
                    output: resultBlock?.content ?? null,
                    metadata: {
                        reconstructed: true,
                        tool_name: (use.name as string) ?? 'mcp_tool',
                        is_error: Boolean(resultBlock?.is_error),
                    },
                },
                generation.spanId,
            );
        }

        if (result.stop_reason === 'refusal') {
            trace.setTrace({ output: '[refusal]' });
            fireAndForget(trace.flush());
            return new Response(JSON.stringify({ error: 'La pregunta no pudo ser respondida' }), {
                status: 422,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        trace.setTrace({ output: answer });
        fireAndForget(trace.flush());

        return new Response(JSON.stringify({ answer }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
```

> The refusal check moved **below** the answer extraction so the generation span is ended exactly once on every path.

> If Task 1 found that `'tool'` is not a supported observation type, change both `'tool'` arguments in this step to `'span'`. The `tool_name` metadata is already present either way.

- [ ] **Step 7: Type-check**

Run: `npx --yes deno@2 check supabase/functions/ask-territorios/index.ts`

Expected: no errors. Deno resolves the `jsr:` imports over the network on first run; that is normal.

- [ ] **Step 8: Deploy and smoke-test**

Run: `npx supabase functions deploy ask-territorios`

Expected: `Deployed Function ask-territorios`.

Then set the secrets if they are not set yet (the user runs this; values come from their Langfuse project):

```bash
npx supabase secrets set LANGFUSE_BASE_URL=https://cloud.langfuse.com LANGFUSE_ENVIRONMENT=production
# LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY set separately by the repo owner
```

Open the deployed app, ask **"¿Cuántos territorios hay libres en Sarrià?"**, and verify in the Langfuse UI:

- Exactly **one** trace named `ask-territorios` appears.
- `userId` is the real Supabase user id; `sessionId` is empty for now (Task 5 adds it).
- The generation shows model `claude-haiku-4-5`, token usage, and a computed cost.
- At least one tool observation appears under the generation, named after a real tool (e.g. `territorios_listar`).

- [ ] **Step 9: Verify telemetry failure is invisible to the user**

Temporarily set a bad key: `npx supabase secrets set LANGFUSE_SECRET_KEY=sk-lf-invalid`

Ask another question in the app.

Expected: the answer arrives **normally**. `npx supabase functions logs ask-territorios` shows a `[langfuse] ingestion rejected 401` warning and nothing else.

Restore the real key afterwards. Confirm with the user that it is restored before moving on.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/ask-territorios/index.ts
git commit -m "feat: trace ask-territorios requests to Langfuse"
```

---

### Task 5: Send a conversation session id from the UI

**Files:**
- Modify: `src/components/AskTerritorios.jsx`

**Interfaces:**
- Consumes: the `sessionId` body field accepted by Task 4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the session id state**

In `src/components/AskTerritorios.jsx`, inside `AskTerritorios()`, add after the `error` state declaration (around line 91):

```jsx
    // Agrupa los mensajes de una misma conversación en Langfuse. Es solo
    // telemetría: el servidor valida la forma y nunca lo usa para autorizar.
    const [sessionId, setSessionId] = useState(() => crypto.randomUUID())
```

- [ ] **Step 2: Send it with the request**

Replace the `supabase.functions.invoke` call body (around line 119):

```jsx
            const { data, error: invokeError } = await supabase.functions.invoke('ask-territorios', {
                body: { messages: nextMessages, sessionId },
            })
```

- [ ] **Step 3: Reset it on a new conversation**

Replace `handleNewConversation`:

```jsx
    const handleNewConversation = () => {
        setMessages([])
        setError('')
        setSessionId(crypto.randomUUID())
    }
```

- [ ] **Step 4: Lint**

Run: `npm run lint`

Expected: no new errors in `src/components/AskTerritorios.jsx`.

- [ ] **Step 5: Verify session grouping end to end**

Run: `npm run dev`, open the app, ask **two** questions in the same conversation, then click "Nueva conversación" and ask a third.

Expected in the Langfuse UI, under Tracing → Sessions: the first two traces share one session id; the third has a different one.

- [ ] **Step 6: Commit**

```bash
git add src/components/AskTerritorios.jsx
git commit -m "feat: group chat turns into Langfuse sessions"
```

---

### Task 6: Eval package, dataset, and agent replica

**Files:**
- Create: `scripts/eval/package.json`
- Create: `scripts/eval/dataset.json`
- Create: `scripts/eval/agent.mjs`
- Create: `scripts/eval/seed-dataset.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks (the eval path is deliberately independent of the edge function).
- Produces:
  - `agent.mjs` exports `askTerritorios(question: string): Promise<{ answer: string; toolCalls: string[]; stopReason: string }>`
  - `dataset.json` is an array of `{ input: string, expectedOutput: string, metadata: { category: string, requiresTool: boolean } }`
  - Valid `category` values: `"lookup"`, `"expired"`, `"zone"`, `"history"`, `"nonexistent"`, `"out-of-scope"`

- [ ] **Step 1: Create the isolated package**

Create `scripts/eval/package.json`:

```json
{
  "name": "ask-territorios-eval",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "description": "Offline evaluation harness for the ask-territorios agent. Isolated from the Vite app's dependency tree.",
  "scripts": {
    "seed": "node --env-file=../../.env seed-dataset.mjs",
    "eval": "node --env-file=../../.env run-experiment.mjs"
  },
  "dependencies": {
    "@langfuse/client": "^5.6.0",
    "@langfuse/otel": "^5.6.0",
    "@opentelemetry/sdk-node": "^0.57.0"
  }
}
```

- [ ] **Step 2: Install**

Run: `cd scripts/eval && npm install`

Expected: installs without error. Note the resolved `@langfuse/client` version — if it is below 5.6.0, stop and report it.

- [ ] **Step 3: Write the agent replica**

Create `scripts/eval/agent.mjs`:

```js
// Réplica de la llamada que hace supabase/functions/ask-territorios/index.ts.
//
// OJO — DUPLICACIÓN CONOCIDA: MODEL y MAX_TOKENS están repetidos aquí y en
// supabase/functions/ask-territorios/index.ts. Si cambias uno, cambia el otro.
// El system prompt NO está duplicado: se lee de Langfuse, que es la fuente única.

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 1024;
const MCP_BETA_HEADER = 'mcp-client-2025-11-20';
const PROMPT_NAME = 'ask-territorios-system';

let cachedPrompt = null;

async function getSystemPrompt() {
  if (cachedPrompt) return cachedPrompt;

  const auth = Buffer.from(
    `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`,
  ).toString('base64');

  const res = await fetch(
    `${process.env.LANGFUSE_BASE_URL}/api/public/v2/prompts/${PROMPT_NAME}?label=production`,
    { headers: { Authorization: `Basic ${auth}` } },
  );

  if (!res.ok) {
    throw new Error(
      `No se pudo leer el prompt de Langfuse (${res.status}). ` +
      'Ejecuta primero: node --env-file=.env scripts/langfuse-seed-prompt.mjs',
    );
  }

  const data = await res.json();
  cachedPrompt = data.prompt;
  return cachedPrompt;
}

export async function askTerritorios(question) {
  const system = await getSystemPrompt();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': MCP_BETA_HEADER,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      mcp_servers: [{
        type: 'url',
        name: 'territorios',
        url: process.env.MCP_SERVER_URL,
        authorization_token: process.env.MCP_SHARED_SECRET,
      }],
      tools: [{ type: 'mcp_toolset', mcp_server_name: 'territorios' }],
      messages: [{ role: 'user', content: question }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  }

  const result = await res.json();
  const blocks = result.content ?? [];

  return {
    answer: blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim(),
    toolCalls: blocks.filter((b) => b.type === 'mcp_tool_use').map((b) => b.name),
    stopReason: result.stop_reason ?? 'unknown',
  };
}
```

- [ ] **Step 4: Verify the replica works**

Run: `cd scripts/eval && node --env-file=../../.env -e "import('./agent.mjs').then(async m => console.log(await m.askTerritorios('¿Cuántos territorios hay en total?')))"`

Expected: an object with a Spanish `answer` mentioning a total, a `toolCalls` array containing at least one tool name, and `stopReason: 'end_turn'`.

If it throws about the prompt, Task 3 Step 3 was not run.

- [ ] **Step 5: Write the dataset**

Create `scripts/eval/dataset.json`. **`expectedOutput` is a grading rubric, not a literal answer** — territory data is a live Google Sheet, so frozen answers would rot. No publisher names: this file is committed to git.

```json
[
  {
    "input": "¿Cuántos territorios hay en total?",
    "expectedOutput": "Debe dar un número total de territorios (alrededor de 180) obtenido de las tools. No debe inventar.",
    "metadata": { "category": "lookup", "requiresTool": true }
  },
  {
    "input": "¿Está libre el territorio 12?",
    "expectedOutput": "Debe indicar claramente si el territorio 12 está libre o asignado, según las tools.",
    "metadata": { "category": "lookup", "requiresTool": true }
  },
  {
    "input": "Dame información del territorio 45",
    "expectedOutput": "Debe describir el territorio 45: su zona, su estado y, si está asignado, desde cuándo.",
    "metadata": { "category": "lookup", "requiresTool": true }
  },
  {
    "input": "¿Qué territorios están vencidos?",
    "expectedOutput": "Debe listar los territorios vencidos con su id, o decir que no hay ninguno. Debe basarse en las tools.",
    "metadata": { "category": "expired", "requiresTool": true }
  },
  {
    "input": "¿Hay algún territorio vencido en Sarrià?",
    "expectedOutput": "Debe responder concretamente sobre la zona Sarrià, listando los vencidos de esa zona o diciendo que no hay.",
    "metadata": { "category": "expired", "requiresTool": true }
  },
  {
    "input": "¿Cuántos territorios llevan más de cuatro meses asignados?",
    "expectedOutput": "Debe entender que eso son los territorios vencidos y dar un número coherente con las tools.",
    "metadata": { "category": "expired", "requiresTool": true }
  },
  {
    "input": "¿Cuántos territorios libres hay en Les Corts Norte?",
    "expectedOutput": "Debe dar un número de territorios libres específico de la zona Les Corts Norte.",
    "metadata": { "category": "zone", "requiresTool": true }
  },
  {
    "input": "Lístame los territorios de Pedralbes",
    "expectedOutput": "Debe listar territorios de la zona Pedralbes con sus ids y estados.",
    "metadata": { "category": "zone", "requiresTool": true }
  },
  {
    "input": "¿Qué zonas hay?",
    "expectedOutput": "Debe nombrar las zonas reales: Les Corts Norte, Les Corts Sur, Pedralbes, Sants y Sarrià.",
    "metadata": { "category": "zone", "requiresTool": true }
  },
  {
    "input": "¿En qué zona hay más territorios sin asignar?",
    "expectedOutput": "Debe comparar zonas y nombrar una zona concreta con un número, coherente con las tools.",
    "metadata": { "category": "zone", "requiresTool": true }
  },
  {
    "input": "¿Cuántos territorios hay asignados ahora mismo?",
    "expectedOutput": "Debe dar el número de territorios asignados obtenido de las tools.",
    "metadata": { "category": "lookup", "requiresTool": true }
  },
  {
    "input": "Dame un resumen del estado de los territorios",
    "expectedOutput": "Debe resumir totales: cuántos libres, cuántos asignados y cuántos vencidos.",
    "metadata": { "category": "lookup", "requiresTool": true }
  },
  {
    "input": "¿Quién tiene asignado el territorio 3?",
    "expectedOutput": "Debe decir quién lo tiene asignado según las tools, o que está libre si no está asignado.",
    "metadata": { "category": "history", "requiresTool": true }
  },
  {
    "input": "¿Cuándo se asignó por última vez el territorio 20?",
    "expectedOutput": "Debe dar una fecha de asignación obtenida de las tools, o decir que no consta.",
    "metadata": { "category": "history", "requiresTool": true }
  },
  {
    "input": "¿Cuál es el historial del territorio 7?",
    "expectedOutput": "Debe describir asignaciones anteriores del territorio 7 según las tools, o decir que no hay historial.",
    "metadata": { "category": "history", "requiresTool": true }
  },
  {
    "input": "¿Está libre el territorio 9999?",
    "expectedOutput": "Debe decir que ese territorio no existe o que no lo encuentra. NO debe inventarse un estado ni una zona.",
    "metadata": { "category": "nonexistent", "requiresTool": true }
  },
  {
    "input": "Dime el estado del territorio de Gracia",
    "expectedOutput": "Debe indicar que no existe esa zona o que no encuentra ese territorio. NO debe inventarse datos.",
    "metadata": { "category": "nonexistent", "requiresTool": true }
  },
  {
    "input": "Asigna el territorio 5 a Juan",
    "expectedOutput": "Debe negarse o explicar que solo puede consultar información, no modificarla. NO debe afirmar que lo ha asignado.",
    "metadata": { "category": "out-of-scope", "requiresTool": false }
  },
  {
    "input": "¿Qué tiempo hace hoy en Barcelona?",
    "expectedOutput": "Debe decir que solo puede responder sobre el estado de los territorios. NO debe dar el tiempo.",
    "metadata": { "category": "out-of-scope", "requiresTool": false }
  },
  {
    "input": "Escríbeme un poema sobre los territorios",
    "expectedOutput": "Debe redirigir a su función de consulta sobre el estado de los territorios en vez de escribir un poema.",
    "metadata": { "category": "out-of-scope", "requiresTool": false }
  }
]
```

- [ ] **Step 6: Write the dataset seeder**

Create `scripts/eval/seed-dataset.mjs`:

```js
// Sube dataset.json al dataset "ask-territorios-v1" de Langfuse.
// Idempotente: los items usan un id estable derivado de la pregunta, así que
// volver a ejecutarlo actualiza en vez de duplicar.
//
// Usage (desde scripts/eval): npm run seed

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const BASE_URL = process.env.LANGFUSE_BASE_URL;
const DATASET_NAME = 'ask-territorios-v1';

const auth = Buffer.from(
  `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`,
).toString('base64');

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Basic ${auth}`,
};

const createRes = await fetch(`${BASE_URL}/api/public/v2/datasets`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    name: DATASET_NAME,
    description: 'Preguntas en español sobre el estado de los territorios. expectedOutput es una rúbrica, no una respuesta literal.',
  }),
});

if (!createRes.ok && createRes.status !== 409) {
  console.error('dataset create failed:', createRes.status, await createRes.text());
  process.exit(1);
}

const items = JSON.parse(await readFile(new URL('./dataset.json', import.meta.url), 'utf8'));

for (const item of items) {
  const id = createHash('sha1').update(item.input).digest('hex').slice(0, 16);
  const res = await fetch(`${BASE_URL}/api/public/dataset-items`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id,
      datasetName: DATASET_NAME,
      input: item.input,
      expectedOutput: item.expectedOutput,
      metadata: item.metadata,
    }),
  });
  if (!res.ok) {
    console.error('item failed:', item.input, res.status, await res.text());
    process.exit(1);
  }
  console.log('ok:', item.input);
}

console.log(`\nSeeded ${items.length} items into "${DATASET_NAME}".`);
```

- [ ] **Step 7: Seed and verify**

Run: `cd scripts/eval && npm run seed`

Expected: one `ok:` line per item and `Seeded 20 items into "ask-territorios-v1".`

Verify in the Langfuse UI under Datasets that `ask-territorios-v1` has 20 items. Run the command a second time and confirm it still shows 20 — not 40.

- [ ] **Step 8: Commit**

```bash
git add scripts/eval/package.json scripts/eval/package-lock.json scripts/eval/dataset.json scripts/eval/agent.mjs scripts/eval/seed-dataset.mjs
git commit -m "feat: add offline eval dataset and agent replica for ask-territorios"
```

---

### Task 7: Evaluators and the experiment runner

**Files:**
- Create: `scripts/eval/evaluators.mjs`
- Create: `scripts/eval/run-experiment.mjs`

**Interfaces:**
- Consumes: `askTerritorios` from `./agent.mjs`; the dataset seeded in Task 6.
- Produces: `evaluators.mjs` exports `accuracy`, `usedTools`, `spanish` — each an `async ({ input, output, expectedOutput, metadata }) => ({ name, value, comment })`. `output` is the object returned by `askTerritorios`.

- [ ] **Step 1: Write the evaluators**

Create `scripts/eval/evaluators.mjs`:

```js
// Tres evaluadores: uno con LLM-as-judge y dos deterministas.
// El `output` que reciben es el objeto que devuelve askTerritorios():
// { answer, toolCalls, stopReason }.

const JUDGE_MODEL = 'claude-sonnet-5';

const JUDGE_SYSTEM =
  'Eres un evaluador estricto. Recibes una PREGUNTA, una RÚBRICA que describe qué debe ' +
  'cumplir una buena respuesta, y la RESPUESTA de un asistente. Puntúa de 0 a 1 según ' +
  'cuánto cumple la rúbrica. Penaliza duramente los datos inventados. ' +
  'Responde SOLO con un JSON: {"score": <0-1>, "reason": "<una frase>"}.';

// LLM-as-judge: compara la respuesta con la rúbrica de expectedOutput.
export async function accuracy({ input, output, expectedOutput }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 300,
      system: JUDGE_SYSTEM,
      messages: [{
        role: 'user',
        content: `PREGUNTA:\n${input}\n\nRÚBRICA:\n${expectedOutput}\n\nRESPUESTA:\n${output.answer}`,
      }],
    }),
  });

  if (!res.ok) {
    return { name: 'accuracy', value: null, comment: `judge error ${res.status}` };
  }

  const data = await res.json();
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');

  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match[0]);
    return { name: 'accuracy', value: Number(parsed.score), comment: parsed.reason };
  } catch {
    return { name: 'accuracy', value: null, comment: `unparseable judge output: ${text.slice(0, 200)}` };
  }
}

// Determinista: ¿usó tools cuando debía, y se abstuvo cuando no debía?
export async function usedTools({ output, metadata }) {
  const requiresTool = metadata?.requiresTool === true;
  const called = output.toolCalls.length > 0;
  const correct = requiresTool ? called : !called;
  return {
    name: 'used-tools',
    value: correct ? 1 : 0,
    comment: requiresTool
      ? `esperaba tool call, ${called ? 'la hubo' : 'NO la hubo'}`
      : `no esperaba tool call, ${called ? 'pero la hubo' : 'y no la hubo'}`,
  };
}

// Determinista y barato: comprueba que la respuesta está en español.
// Heurística: palabras funcionales frecuentes en español y ausencia de las inglesas.
const ES_MARKERS = /\b(el|la|los|las|de|que|está|están|hay|no|para|con|territorio|territorios|zona)\b/i;
const EN_MARKERS = /\b(the|is|are|there|and|of|for|territory|assigned|free)\b/i;

export async function spanish({ output }) {
  const text = output.answer ?? '';
  if (!text.trim()) {
    return { name: 'spanish', value: 0, comment: 'respuesta vacía' };
  }
  const es = ES_MARKERS.test(text);
  const en = EN_MARKERS.test(text);
  const value = es && !en ? 1 : 0;
  return {
    name: 'spanish',
    value,
    comment: value === 1 ? 'en español' : `marcadores es=${es} en=${en}`,
  };
}
```

- [ ] **Step 2: Write the experiment runner**

Create `scripts/eval/run-experiment.mjs`:

```js
// Ejecuta el dataset ask-territorios-v1 contra el agente y sube el experimento
// a Langfuse con environment "evaluation", para no mezclarlo con producción.
//
// Usage (desde scripts/eval): npm run eval

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { LangfuseClient } from '@langfuse/client';
import { askTerritorios } from './agent.mjs';
import { accuracy, usedTools, spanish } from './evaluators.mjs';

process.env.LANGFUSE_TRACING_ENVIRONMENT = 'evaluation';

const otelSdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
otelSdk.start();

const langfuse = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL,
});

const dataset = await langfuse.dataset.get('ask-territorios-v1');

const result = await dataset.runExperiment({
  name: 'ask-territorios',
  runName: `local-${new Date().toISOString().slice(0, 16)}`,
  description: 'Evaluación offline del agente de territorios contra la rúbrica del dataset.',
  task: async (item) => askTerritorios(item.input),
  evaluators: [accuracy, usedTools, spanish],
  // Secuencial a propósito: las tools pegan a una hoja de Google compartida
  // y la API de Anthropic tiene rate limits. 20 items tardan ~2 minutos.
  maxConcurrency: 2,
});

console.log(await result.format());

await otelSdk.shutdown();
```

- [ ] **Step 3: Verify the SDK surface before running**

The `@langfuse/client` API moves between versions. Before running, confirm `dataset.runExperiment` and the evaluator signature against the current docs:

Run: `curl -s "https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk.md" | head -120`

Check that `runExperiment` still accepts `{ name, runName, description, task, evaluators, maxConcurrency }` and that evaluators still receive `{ input, output, expectedOutput, metadata }`. If the surface changed, adjust `run-experiment.mjs` and `evaluators.mjs` to match the docs — the docs are authoritative, not this plan.

- [ ] **Step 4: Run the experiment**

Run: `cd scripts/eval && npm run eval`

Expected: a formatted table with 20 rows and average scores for `accuracy`, `used-tools`, and `spanish`. Runtime roughly 2–4 minutes.

- [ ] **Step 5: Sanity-check the scores, not just the run**

A green run that measures nothing is worse than no run. Verify in the Langfuse UI (Datasets → `ask-territorios-v1` → Runs):

- `used-tools` should be **1.0** for the three `out-of-scope` items (no tool call) — if it is 0, the agent is calling tools for "¿Qué tiempo hace?", which is a real finding worth reporting.
- `accuracy` on the two `nonexistent` items is the hallucination check. If those score high, good. If they score low, read the judge's `comment` — that is the most valuable signal in the whole run.
- If `accuracy` is 1.0 across all 20 items, be suspicious: check two judge comments to confirm the judge is actually reading the rubric and not rubber-stamping.

Report the aggregate scores and any item scoring below 0.5 to the user.

- [ ] **Step 6: Commit**

```bash
git add scripts/eval/evaluators.mjs scripts/eval/run-experiment.mjs
git commit -m "feat: add LLM-judge and deterministic evaluators for ask-territorios"
```

---

### Task 8: Document the observability layer

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything built in Tasks 1–7.
- Produces: nothing.

- [ ] **Step 1: Add an observability section to `CLAUDE.md`**

Insert a new `### Observability (Langfuse)` subsection under `## Architecture`, after the "Admin operations go through Supabase Edge Functions" subsection:

```markdown
### Observability (Langfuse)

The `ask-territorios` agent is traced to Langfuse Cloud EU.

- **Transport**: `supabase/functions/_shared/langfuse.ts` hand-builds OTLP/HTTP JSON and POSTs it to `/api/public/otel/v1/traces`. It has **zero dependencies on purpose** — it runs in the Deno edge runtime. Do not "improve" this by pulling in the Langfuse SDK or an OTEL stack.
- **Never blocks**: the flush runs via `EdgeRuntime.waitUntil` after the response is returned, and every Langfuse call is wrapped in try/catch. If `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` are absent, all tracing silently no-ops so local dev works without Langfuse. Preserve both properties.
- **Tool observations are reconstructed**, not measured. Anthropic's MCP connector executes tools on its own servers, so we only get `mcp_tool_use`/`mcp_tool_result` blocks back — name, args, result, but no latency. They are recorded with zero duration and `metadata.reconstructed=true`. Trace context also cannot cross the MCP connector, which is why `api/mcp.js` is deliberately not instrumented.
- **System prompt lives in Langfuse** (`ask-territorios-system`, label `production`), fetched by `supabase/functions/_shared/prompt.ts` with a 60s module-scope cache. `FALLBACK_SYSTEM_PROMPT` in that file is the safety net and must stay in sync with the seeded prompt — `scripts/langfuse-seed-prompt.mjs` pushes it.
- **Evals**: `scripts/eval/` is an isolated Node package (like `mcp-server/`) so `@langfuse/client` stays out of the Vite app's tree. `npm run seed` uploads `dataset.json`; `npm run eval` runs the experiment. `expectedOutput` in the dataset is a **grading rubric, not a literal answer**, because territory data is a live Google Sheet and frozen answers would rot. The dataset must never contain real publisher names.
- **Known duplication**: `MODEL` and `MAX_TOKENS` exist in both `supabase/functions/ask-territorios/index.ts` and `scripts/eval/agent.mjs`. Change both together.
- **Env vars**: `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_ENVIRONMENT` — set as Supabase secrets for the deployed function and in a gitignored root `.env` for the scripts.
```

- [ ] **Step 2: Add the eval commands to the Commands section**

Under `## Commands`, after the MCP server subsection, add:

```markdown
### Evals (`scripts/eval/`)

Separate Node package, not part of the Vite app's dependency tree. Needs a root `.env` with the Langfuse, Anthropic, and MCP variables.

- `cd scripts/eval && npm install`
- `npm run seed` — upload `dataset.json` to the Langfuse dataset `ask-territorios-v1`
- `npm run eval` — run the experiment and print scores
- `node --env-file=.env scripts/langfuse-seed-prompt.mjs` (from repo root) — push the system prompt to Langfuse
- `node --env-file=.env scripts/langfuse-otel-spike.mjs` (from repo root) — debug the OTLP wire format when traces stop appearing
```

- [ ] **Step 3: Verify the doc matches reality**

Re-read the new sections against the files actually created. Confirm every path, script name, and npm command mentioned exists. Fix any mismatch.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the Langfuse observability layer"
```

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| OTLP/JSON transport, zero deps | 1, 2 |
| Trace shape (trace / span / generation / tool) | 2, 4 |
| userId from JWT, sessionId from client (validated) | 4, 5 |
| Cost, usage, model parameters | 4 |
| Error + refusal levels | 4 |
| Tool observations reconstructed, truncated | 2 (`MAX_VALUE_CHARS`), 4 |
| Fire-and-forget flush | 4 (`fireAndForget`) |
| Prompt management with fallback | 3 |
| Prompt seeding script | 3 |
| Environments (production/development/evaluation) | 4, 7 |
| Eval dataset, no personal data | 6 |
| Agent replica for evals | 6 |
| 3 evaluators | 7 |
| Verification: spike, smoke, failure, fallback, eval run | 1, 2, 4, 7 |
| Documentation | 8 |

**Deviation from the spec:** the spec described `expectedOutput` as literal expected answers. Live Google Sheet data makes that untenable, so Task 6 uses grading rubrics instead. The prompt-fallback verification from the spec's Verification section is covered by the fallback path being exercised in Task 2 Step 5 (disabled path) rather than by deleting the production label, which would risk leaving the deployed agent without its managed prompt.

// VERIFIED 2026-07-21: status 200. observation.type "tool" -> supported.
// Langfuse's public GET /api/public/traces/{id} echoes it back as the
// uppercased literal "TOOL" (Langfuse normalizes/uppercases observation
// types internally). Later tasks may use 'tool' as the OTLP attribute value
// on langfuse.observation.type and expect it to survive as its own
// observation type (not coerced to a generic span).
//
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
const sessionId = crypto.randomUUID();

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
                attr('langfuse.session.id', sessionId),
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

const resBodyText = await res.text();
console.log('status:', res.status);
console.log('body:', resBodyText);
console.log('traceId:', traceId);
console.log(`open: ${BASE_URL} -> Tracing -> Traces, look for trace id ${traceId}`);

if (res.status !== 200 && res.status !== 202) {
  console.error(`Unexpected status ${res.status}, aborting verification.`);
  process.exit(1);
}

// --- Step 4 (programmatic, no browser): poll the public API for the trace ---
// Ingestion is async, so the trace may not be queryable immediately after the
// POST returns. Poll GET /api/public/traces/{traceId} with the same Basic auth
// until it returns 200, then assert on the shape of the response.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollForTrace(id, { timeoutMs = 60_000, intervalMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus;
  let lastBody;
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE_URL}/api/public/traces/${id}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    lastStatus = r.status;
    if (r.status === 200) {
      return { status: r.status, json: await r.json() };
    }
    lastBody = await r.text().catch(() => '');
    await sleep(intervalMs);
  }
  throw new Error(
    `Timed out waiting for trace ${id} to become queryable. Last status: ${lastStatus}, body: ${lastBody}`
  );
}

console.log('\nPolling GET /api/public/traces/{traceId} until ingestion completes...');
const { status: fetchStatus, json: trace } = await pollForTrace(traceId);
console.log('trace-fetch status:', fetchStatus);

const observations = trace.observations ?? [];
const generation = observations.find((o) => o.type === 'GENERATION' || o.name === 'anthropic-messages');
const toolObservation = observations.find((o) => o.name === 'territorios_vencidos');

const checks = [
  ['trace.name === "ask-territorios"', trace.name === 'ask-territorios', trace.name],
  ['trace.userId === "spike-user"', trace.userId === 'spike-user', trace.userId],
  ['trace.sessionId === generated session id', trace.sessionId === sessionId, trace.sessionId],
  ['observations.length === 3', observations.length === 3, observations.length],
  [
    'generation.model === "claude-haiku-4-5"',
    generation?.model === 'claude-haiku-4-5',
    generation?.model,
  ],
  [
    'generation has non-zero token usage',
    !!generation && (generation.usage?.input > 0 || generation.usage?.promptTokens > 0),
    generation?.usage,
  ],
  [
    'generation has non-null cost',
    !!generation && generation.calculatedTotalCost != null,
    generation?.calculatedTotalCost,
  ],
  ['tool observation found', !!toolObservation, toolObservation?.name],
];

console.log('\n--- Verification assertions ---');
for (const [label, pass, actual] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${label} (actual: ${JSON.stringify(actual)})`);
}

console.log(
  `\nLITERAL observation.type for territorios_vencidos: ${JSON.stringify(toolObservation?.type)}`
);

const allPassed = checks.every(([, pass]) => pass);
if (!allPassed) {
  console.error('\nOne or more verification assertions FAILED. See above.');
  process.exit(1);
}

console.log('\nAll verification assertions passed.');

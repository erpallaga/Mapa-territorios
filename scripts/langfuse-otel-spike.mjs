// VERIFIED 2026-09-21 contra Langfuse v4: status 200 y las 14 asserciones de
// `checks` en verde. El contrato real de este script es su código de salida
// (0 sólo si pasan todas); este comentario sólo orienta sobre qué importa:
//
//   - `langfuse.observation.type: "tool"` sobrevive como tipo propio. La API de
//     lectura lo devuelve en mayúsculas ("TOOL"), así que se comprueba sin
//     distinguir mayúsculas.
//   - El `parentSpanId` de OTLP produce anidamiento real de observaciones: la
//     API lo devuelve como `parentObservationId`, con el id de observación del
//     padre (que es el spanId hex que generamos). Se comprueba en los dos
//     saltos: raíz -> generación y generación -> tool.
//   - v4: la observación raíz lleva el input/output de conjunto y se marca con
//     `isRootObservation`. Lo que agrupa (usuario, sesión, nombre, tags) viaja
//     en TODAS las observaciones, no sólo en la raíz — sin `session.id` en la
//     generación, su coste no cuenta para el coste de la sesión.
//
// Utilidad de desarrollo: manda una traza OTLP/JSON construida a mano para
// verificar el formato de hilo que usa supabase/functions/_shared/langfuse.ts.
// Es lo primero que hay que ejecutar cuando dejan de aparecer trazas.
//
// Uso: node --env-file=.env scripts/langfuse-otel-spike.mjs
//
// Autenticación: LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY, o ninguna de las dos
// si un proxy de salida ya inyecta la cabecera Authorization. Ver
// scripts/auditar-trazas.mjs.

// Node >= 22.21 ignora HTTPS_PROXY en su `fetch` salvo que NODE_USE_ENV_PROXY=1
// esté puesto ANTES de arrancar, así que hay que relanzarse.
if (!process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy)) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 1);
}

const BASE_URL = (process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com').replace(/\/$/, '');
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

const AUTH = PUBLIC_KEY && SECRET_KEY
  ? 'Basic ' + Buffer.from(`${PUBLIC_KEY}:${SECRET_KEY}`).toString('base64')
  : null;

if (!AUTH) {
  console.error('Sin LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY: se asume que un proxy');
  console.error('inyecta la cabecera Authorization.\n');
}

const cabeceras = (extra = {}) => ({
  Accept: 'application/json',
  ...(AUTH ? { Authorization: AUTH } : {}),
  ...extra,
});

// Langfuse v4 exige esta cabecera a los exportadores propios. Sin ella la
// petición responde 200 igual, pero la traza se queda en el camino de ingesta
// v3 y no aparece en ninguna lectura v4: el fallo es silencioso.
const INGESTION_VERSION = '4';

const hex = (bytes) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const traceId = hex(16); // 32 caracteres hex
const rootId = hex(8);   // 16 caracteres hex
const genId = hex(8);
const toolId = hex(8);
const sessionId = crypto.randomUUID();

const now = Date.now();
const nano = (ms) => String(BigInt(Math.round(ms)) * 1_000_000n);

// Contrato: `value` debe ser un primitivo, un array de cadenas, o un objeto ya
// serializado con JSON.stringify. NO serializa objetos por su cuenta: pasarle
// un objeto crudo cae en la rama stringValue y se convierte en el inútil
// "[object Object]". Los arrays sí se tratan de forma nativa, porque los tags
// mandados como el JSON '["a","b"]' llegan como un solo tag con corchetes.
const attr = (key, value) => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return { key, value: { intValue: String(value) } };
  }
  if (typeof value === 'number') return { key, value: { doubleValue: value } };
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  if (Array.isArray(value)) {
    return { key, value: { arrayValue: { values: value.map((v) => ({ stringValue: String(v) })) } } };
  }
  return { key, value: { stringValue: String(value) } };
};

// Lo que identifica y agrupa. En v4 va en TODAS las observaciones: es la parte
// que `propagateAttributes` hace por ti cuando usas el SDK.
const propagados = [
  attr('langfuse.trace.name', 'ask-territorios'),
  attr('user.id', 'spike-user'),
  attr('session.id', sessionId),
  attr('langfuse.trace.tags', ['ask-territorios', 'spike']),
  attr('langfuse.environment', 'development'),
];

const span = ({ spanId, parentSpanId, name, start, end, attributes }) => ({
  traceId,
  spanId,
  ...(parentSpanId ? { parentSpanId } : {}),
  name,
  kind: 1,
  startTimeUnixNano: nano(start),
  endTimeUnixNano: nano(end),
  attributes: [...attributes, ...propagados],
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
                attr('langfuse.observation.type', 'span'),
                // v4: la raíz se marca, y el input/output de conjunto es suyo.
                // `langfuse.trace.input`/`output` están deprecados y se descartan.
                attr('langfuse.internal.is_app_root', true),
                attr('langfuse.observation.input', '¿Qué territorios están vencidos?'),
                attr('langfuse.observation.output', 'Hay 2 territorios vencidos en Sarrià.'),
              ],
            }),
            span({
              spanId: genId,
              parentSpanId: rootId,
              name: 'anthropic-messages',
              start: now - 1400,
              end: now - 200,
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
              start: now - 1000,
              end: now - 900,
              attributes: [
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

const res = await fetch(`${BASE_URL}/api/public/otel/v1/traces`, {
  method: 'POST',
  headers: cabeceras({
    'Content-Type': 'application/json',
    'x-langfuse-ingestion-version': INGESTION_VERSION,
  }),
  body: JSON.stringify(body),
});

const resBodyText = await res.text();
console.log('status:', res.status);
console.log('traceId:', traceId);
console.log(`abre: ${BASE_URL} -> Tracing, busca la traza ${traceId}`);

// La respuesta devuelve el trabajo encolado, y dentro la versión de ingesta con
// la que Langfuse lo ha aceptado. Si sale "" en vez de "4", la cabecera no ha
// llegado y todo lo demás se ingiere por el camino viejo.
let ingestionVersion = null;
try {
  ingestionVersion = JSON.parse(resBodyText)?.data?.payload?.ingestionVersion ?? null;
} catch { /* la respuesta no era JSON; el status manda */ }
console.log('ingestionVersion aceptada:', JSON.stringify(ingestionVersion));

if (res.status !== 200 && res.status !== 202) {
  console.error('body:', resBodyText);
  console.error(`Status inesperado ${res.status}, se aborta la verificación.`);
  process.exit(1);
}

// --- Lectura: la API v2 de observaciones ---
// GET /api/public/traces/{id} y GET /api/public/observations son los endpoints
// de v3 y Langfuse Cloud los apaga el 16 de noviembre de 2026. El camino de
// lectura en tiempo real de v4 es GET /api/public/v2/observations.
// La ingesta es asíncrona, así que hay que insistir hasta que aparezca.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function esperarObservaciones(id, { timeoutMs = 120_000, intervalMs = 3_000 } = {}) {
  const limite = Date.now() + timeoutMs;
  let ultimoStatus;
  let ultimoCuerpo;
  while (Date.now() < limite) {
    const url = new URL(`${BASE_URL}/api/public/v2/observations`);
    url.searchParams.set('traceId', id);
    url.searchParams.set('fields', 'core,basic,io,metadata,model,usage,prompt,trace_context');
    url.searchParams.set('limit', '50');

    const r = await fetch(url, { headers: cabeceras() });
    ultimoStatus = r.status;

    if (r.status === 200) {
      const json = await r.json();
      // 200 con lista vacía = todavía no ingerida, hay que seguir esperando.
      if (json?.data?.length) return json.data;
      ultimoCuerpo = 'data: []';
    } else if (r.status >= 400 && r.status < 500) {
      // Un 4xx aquí es terminal: la petición está mal y no mejorará esperando.
      const err = await r.text().catch(() => '');
      throw new Error(`Error terminal ${r.status} leyendo la traza ${id}. Body: ${err}`);
    } else {
      ultimoCuerpo = await r.text().catch(() => '');
    }
    await sleep(intervalMs);
  }
  throw new Error(
    `Se agotó la espera de la traza ${id}. Último status: ${ultimoStatus}, body: ${ultimoCuerpo}`,
  );
}

console.log('\nEsperando a GET /api/public/v2/observations...');
const observations = await esperarObservaciones(traceId);

// Los ids de observación son exactamente los spanId hex de arriba, así que se
// buscan por id y no por nombre: es lo que permite afirmar el anidamiento sin
// ambigüedad.
const root = observations.find((o) => o.id === rootId);
const generation = observations.find((o) => o.id === genId);
const toolObservation = observations.find((o) => o.id === toolId);

const checks = [
  ['la ingesta se aceptó como versión 4', ingestionVersion === '4', ingestionVersion],
  ['hay 3 observaciones', observations.length === 3, observations.length],
  ['root.isRootObservation === true', root?.isRootObservation === true, root?.isRootObservation],
  [
    'root.traceName === "ask-territorios"',
    root?.traceName === 'ask-territorios',
    root?.traceName,
  ],
  // Las dos que atrapan la regresión de v4: si alguien vuelve a poner el
  // input/output en `langfuse.trace.*`, la raíz los devuelve a null.
  [
    'la raíz lleva el input de conjunto (no langfuse.trace.input, deprecado)',
    typeof root?.input === 'string' && root.input.includes('vencidos'),
    root?.input,
  ],
  [
    'la raíz lleva el output de conjunto (no langfuse.trace.output, deprecado)',
    typeof root?.output === 'string' && root.output.includes('Sarrià'),
    root?.output,
  ],
  ['root.userId === "spike-user"', root?.userId === 'spike-user', root?.userId],
  // La que protege el coste por sesión: si `session.id` sólo va en la raíz, la
  // generación queda fuera de la sesión y su coste no se suma.
  [
    'la generación lleva el sessionId (si no, su coste no cuenta en la sesión)',
    generation?.sessionId === sessionId,
    generation?.sessionId,
  ],
  [
    'generation.model === "claude-haiku-4-5"',
    generation?.model === 'claude-haiku-4-5',
    generation?.model,
  ],
  [
    'la generación tiene uso de tokens',
    (generation?.usageDetails?.input ?? 0) > 0,
    generation?.usageDetails,
  ],
  ['la generación tiene coste', generation?.totalCost != null, generation?.totalCost],
  [
    'la generación conserva el prompt de Langfuse',
    generation?.promptName === 'ask-territorios-system',
    generation?.promptName,
  ],
  [
    'la raíz no tiene padre (parentObservationId === null)',
    !!root && root.parentObservationId == null,
    root?.parentObservationId,
  ],
  [
    'generation.parentObservationId === id de la raíz (parentSpanId -> anidamiento real)',
    !!generation && !!root && generation.parentObservationId === root.id,
    generation?.parentObservationId,
  ],
  [
    'toolObservation.parentObservationId === id de la generación',
    !!toolObservation && !!generation && toolObservation.parentObservationId === generation.id,
    toolObservation?.parentObservationId,
  ],
  [
    'el tipo "tool" sobrevive como tipo propio (sin distinguir mayúsculas)',
    typeof toolObservation?.type === 'string' && toolObservation.type.toLowerCase() === 'tool',
    toolObservation?.type,
  ],
];

console.log('\n--- Verificación ---');
for (const [label, pass, actual] of checks) {
  console.log(`${pass ? 'PASA' : 'FALLA'}: ${label} (real: ${JSON.stringify(actual)})`);
}

console.log(
  `\nobservation.type LITERAL de territorios_vencidos: ${JSON.stringify(toolObservation?.type)}`,
);

if (!checks.every(([, pass]) => pass)) {
  console.error('\nHay comprobaciones que FALLAN. Mira arriba.');
  process.exit(1);
}

console.log('\nTodas las comprobaciones pasan.');

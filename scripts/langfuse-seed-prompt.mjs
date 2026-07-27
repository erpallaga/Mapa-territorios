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

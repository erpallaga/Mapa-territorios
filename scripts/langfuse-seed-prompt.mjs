// Sube el system prompt de ask-territorios a Langfuse con la etiqueta "production".
// Idempotente: Langfuse versiona el prompt, así que ejecutarlo dos veces con el
// mismo texto solo crea una versión nueva idéntica.
//
// Uso:
//   npm run seed-prompt
//   npm run seed-prompt -- --dry-run    # enseña qué subiría, sin subir nada
//
// El texto NO se escribe aquí: se lee de FALLBACK_SYSTEM_PROMPT en
// supabase/functions/_shared/prompt.ts, que es la copia que la edge function usa
// cuando Langfuse no responde. Antes estaba duplicado en los dos sitios con un
// comentario pidiendo mantenerlos a mano en sintonía, y se desincronizó: el
// fichero llevaba instrucciones nuevas y este script seguía empujando las
// viejas, de modo que ejecutarlo revertía producción en silencio.
//
// Autenticación: LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY, o ninguna de las dos
// si un proxy de salida ya inyecta la cabecera Authorization (una "API
// credential" de un entorno cloud de Claude Code). Ver scripts/auditar-trazas.mjs.

// Node >= 22.21 ignora HTTPS_PROXY en su `fetch` salvo que NODE_USE_ENV_PROXY=1
// esté puesto ANTES de arrancar, así que hay que relanzarse: asignarlo aquí
// llega tarde.
if (!process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy)) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 1);
}

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dryRun = process.argv.includes('--dry-run');

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

const PROMPT_NAME = 'ask-territorios-system';
const PROMPT_TS = fileURLToPath(new URL('../supabase/functions/_shared/prompt.ts', import.meta.url));

/** Extrae el literal de FALLBACK_SYSTEM_PROMPT del fichero de la edge function. */
async function leerPrompt() {
  const src = await readFile(PROMPT_TS, 'utf8');
  const m = src.match(/export const FALLBACK_SYSTEM_PROMPT = `([\s\S]*?)`;/);
  if (!m) {
    throw new Error(`No se encuentra FALLBACK_SYSTEM_PROMPT en ${PROMPT_TS}. Si ha cambiado de forma, arregla este script antes de subir nada.`);
  }
  const texto = m[1];
  // Si la extracción se rompiera a medias, mejor fallar que publicar un prompt
  // truncado en producción.
  if (texto.length < 500 || !texto.includes('QUÉ TOOL USAR')) {
    throw new Error(`El prompt extraído no tiene la pinta esperada (${texto.length} caracteres). No se sube nada.`);
  }
  return texto;
}

const prompt = await leerPrompt();

// Qué hay ahora en producción, para poder decir qué cambia.
let actual = null;
try {
  const res = await fetch(`${BASE_URL}/api/public/v2/prompts/${PROMPT_NAME}?label=production`, {
    headers: cabeceras(),
  });
  if (res.ok) actual = await res.json();
  else console.warn(`(no se ha podido leer la versión actual: ${res.status})`);
} catch (err) {
  console.warn('(no se ha podido leer la versión actual:', err.message + ')');
}

console.log(`Prompt: ${PROMPT_NAME} @ ${BASE_URL}`);
console.log(`Local:  ${prompt.length} caracteres (de prompt.ts)`);
if (actual) {
  console.log(`Remoto: versión ${actual.version}, ${String(actual.prompt ?? '').length} caracteres`);
  if (actual.prompt === prompt) {
    console.log('\nYa son idénticos: no hace falta subir nada.');
    process.exit(0);
  }
  console.log('\nDifieren. Secciones nuevas en local:');
  for (const linea of prompt.split('\n')) {
    const cabecera = linea.match(/^([A-ZÁÉÍÓÚÑ ]{3,}):/);
    if (cabecera && !String(actual.prompt ?? '').includes(cabecera[1] + ':')) {
      console.log(`  + ${cabecera[1]}`);
    }
  }
}

if (dryRun) {
  console.log('\n--dry-run: no se sube nada.');
  process.exit(0);
}

const res = await fetch(`${BASE_URL}/api/public/v2/prompts`, {
  method: 'POST',
  headers: cabeceras({ 'Content-Type': 'application/json' }),
  body: JSON.stringify({
    name: PROMPT_NAME,
    type: 'text',
    prompt,
    labels: ['production'],
  }),
});

const body = await res.text();
console.log('\nstatus:', res.status);
if (!res.ok) {
  console.error('body:', body);
  process.exit(1);
}

let version = null;
try {
  version = JSON.parse(body)?.version ?? null;
} catch { /* la respuesta no era JSON; el status ya dice que fue bien */ }
console.log(version !== null ? `Subido como versión ${version}, etiquetada production.` : 'Subido y etiquetado production.');

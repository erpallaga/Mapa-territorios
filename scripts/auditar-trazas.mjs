// Audita las trazas de Langfuse buscando preguntas que el agente NO supo
// responder, y separa las que fallaron por falta de tools en el MCP de las que
// fallaron por otra cosa.
//
// La pregunta que contesta es: "¿hay algo que la gente pregunte y que el MCP no
// pueda contestar?". Es la única forma honesta de decidir si hacen falta tools
// nuevas: el catálogo actual son 8 tools, y ampliarlo a ojo es adivinar.
//
// Clasifica cada traza en una de estas categorías, de peor a mejor:
//
//   - error / refusal : la petición acabó mal (nivel ERROR o stop_reason refusal).
//   - sin-tools       : el agente contestó sin llamar a ninguna tool. Si la
//                       pregunta pedía datos, la respuesta se la inventó o se
//                       excusó; en ambos casos es sospechosa.
//   - evasiva         : llamó a tools pero la respuesta contiene una fórmula de
//                       "no puedo / no dispongo / no tengo forma de saber".
//                       Este es el patrón que delata una tool que falta.
//   - insistente      : llamó 4 o más veces a tools para una sola pregunta, o
//                       repitió la misma tool 3 veces. Señal de que estuvo
//                       dando tumbos buscando un dato que no está expuesto.
//   - ok              : el resto.
//
// Además cruza cada pregunta con las carencias conocidas del MCP (año de
// servicio, viviendas, geografía...) para no depender solo de las heurísticas.
//
// Uso:
//   node --env-file=.env scripts/auditar-trazas.mjs
//   node --env-file=.env scripts/auditar-trazas.mjs --dias 90
//   node --env-file=.env scripts/auditar-trazas.mjs --todas   # lista también las OK
//
// Necesita LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY y LANGFUSE_SECRET_KEY, las
// mismas que ya usan las edge functions y los scripts de eval.

const NOMBRE_TRAZA = 'ask-territorios';
const LIMITE_PAGINA = 50;
const MAX_PAGINAS = 20;

// Fórmulas con las que un modelo se excusa cuando le falta una capacidad.
// Deliberadamente incluye las educadas: "tendrías que mirarlo en el panel".
const EVASIVAS = [
  /no (puedo|podr[ií]a|consigo|s[eé])\b/i,
  /no (tengo|dispongo|cuento con)\b/i,
  /no (hay|existe|est[aá] disponible) (ninguna |una )?(forma|manera|herramienta|tool|opci[oó]n)/i,
  /no .{0,30}(informaci[oó]n|datos) (sobre|de|para)/i,
  /(fuera|m[aá]s all[aá]) de (mi|las) (alcance|capacidad|posibilidades|herramientas)/i,
  /tendr[ií]as que (mirar|consultar|revisar)/i,
  /(consulta|revisa|mira)(lo)? (directamente )?(en )?(el|la) (panel|hoja|mapa|Sheet)/i,
  /no .{0,20}(registra|recoge|guarda)/i,
];

// Carencias que ya conocemos por lectura del código. Si una pregunta menciona
// estas cosas, el MCP no tiene cómo contestarla por mucho que el agente lo
// intente. Sirven para confirmar (o desmentir) las heurísticas de arriba.
const CARENCIAS_CONOCIDAS = [
  { id: 'anyo-servicio', re: /a[nñ]o de servicio|cerrar el a[nñ]o|campa[nñ]a|desde septiembre|curso \d{2}/i },
  { id: 'viviendas', re: /vivienda|casas|puertas|tama[nñ]o del territorio|m[aá]s grande|m[aá]s peque[nñ]o/i },
  { id: 'geografia', re: /cerca|al lado|colinda|vecino|junto a|calle|direcci[oó]n|mapa/i },
  { id: 'escritura', re: /as[ií]gnale|as[ií]gname|apunta|anota|marca como|actualiza|cambia el estado/i },
  { id: 'prediccion', re: /cu[aá]ndo (deber[ií]a|tocar[aá]|toca)|pron[oó]stico|previsi[oó]n|ritmo|a este paso/i },
  { id: 'comparativa-temporal', re: /comparado con|frente al a[nñ]o|respecto al a[nñ]o|mismo periodo|el a[nñ]o pasado por estas/i },
];

function arg(nombre, pordefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : pordefecto;
}

function auth() {
  const { LANGFUSE_PUBLIC_KEY: pk, LANGFUSE_SECRET_KEY: sk } = process.env;
  if (!pk || !sk) {
    console.error('Faltan LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY.');
    console.error('Ejecuta:  node --env-file=.env scripts/auditar-trazas.mjs');
    process.exit(1);
  }
  return `Basic ${Buffer.from(`${pk}:${sk}`).toString('base64')}`;
}

async function api(ruta, params = {}) {
  const base = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
  const url = new URL(`${base}/api/public/${ruta}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { Authorization: auth() } });
  if (!res.ok) {
    throw new Error(`Langfuse ${res.status} en ${ruta}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

/** Todas las trazas del agente desde hace N días, paginando. */
async function traerTrazas(dias) {
  const desde = new Date(Date.now() - dias * 86400000).toISOString();
  const todas = [];
  for (let page = 1; page <= MAX_PAGINAS; page++) {
    const data = await api('traces', {
      name: NOMBRE_TRAZA,
      fromTimestamp: desde,
      limit: LIMITE_PAGINA,
      page,
    });
    const lote = data?.data ?? [];
    todas.push(...lote);
    if (lote.length < LIMITE_PAGINA) break;
  }
  return todas;
}

/** Las observaciones de una traza: de ahí salen los nombres de las tools. */
async function traerObservaciones(traceId) {
  const data = await api('observations', { traceId, limit: 100 });
  return data?.data ?? [];
}

function textoDe(valor) {
  if (typeof valor === 'string') return valor;
  if (valor == null) return '';
  try { return JSON.stringify(valor); } catch { return String(valor); }
}

function clasificar(traza, tools) {
  const salida = textoDe(traza.output);
  const nivel = String(traza.level ?? '').toUpperCase();

  if (nivel === 'ERROR' || salida === '[refusal]') return 'error';
  if (tools.length === 0) return 'sin-tools';
  if (EVASIVAS.some((re) => re.test(salida))) return 'evasiva';

  const repetidas = new Map();
  for (const t of tools) repetidas.set(t, (repetidas.get(t) || 0) + 1);
  const maxRepe = Math.max(...repetidas.values());
  if (tools.length >= 4 || maxRepe >= 3) return 'insistente';

  return 'ok';
}

function carenciasDe(pregunta) {
  return CARENCIAS_CONOCIDAS.filter((c) => c.re.test(pregunta)).map((c) => c.id);
}

async function main() {
  const dias = Number(arg('dias', '90'));
  const verTodas = process.argv.includes('--todas');

  console.log(`Leyendo trazas "${NOMBRE_TRAZA}" de los últimos ${dias} días...\n`);
  const trazas = await traerTrazas(dias);

  if (trazas.length === 0) {
    console.log('No hay ninguna traza en ese periodo. Prueba con --dias 365.');
    return;
  }

  const filas = [];
  const usoTools = new Map();

  for (const t of trazas) {
    const obs = await traerObservaciones(t.id);
    const tools = obs
      .filter((o) => String(o.type).toUpperCase() === 'TOOL' || o.metadata?.reconstructed)
      .map((o) => o.name)
      .filter(Boolean);

    for (const n of tools) usoTools.set(n, (usoTools.get(n) || 0) + 1);

    const pregunta = textoDe(t.input).trim();
    filas.push({
      fecha: (t.timestamp || '').slice(0, 10),
      pregunta,
      respuesta: textoDe(t.output).trim(),
      tools,
      clase: clasificar(t, tools),
      carencias: carenciasDe(pregunta),
    });
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  const porClase = new Map();
  for (const f of filas) porClase.set(f.clase, (porClase.get(f.clase) || 0) + 1);

  console.log(`${filas.length} preguntas analizadas\n`);
  console.log('Clasificación');
  for (const clase of ['error', 'sin-tools', 'evasiva', 'insistente', 'ok']) {
    const n = porClase.get(clase) || 0;
    const pct = ((n / filas.length) * 100).toFixed(1);
    console.log(`  ${clase.padEnd(12)} ${String(n).padStart(4)}  ${pct.padStart(5)}%`);
  }

  // ── Uso de cada tool ──────────────────────────────────────────────────────
  const TOOLS_MCP = [
    'territorios_listar', 'territorios_buscar_por_id', 'territorios_vencidos',
    'territorios_estadisticas', 'territorios_buscar_por_publicador',
    'territorios_actividad', 'publicadores_listar', 'territorios_sin_trabajar',
  ];
  console.log('\nUso de tools');
  for (const n of TOOLS_MCP) {
    const veces = usoTools.get(n) || 0;
    console.log(`  ${n.padEnd(36)} ${String(veces).padStart(4)}${veces === 0 ? '   <-- NUNCA USADA' : ''}`);
  }
  const desconocidas = [...usoTools.keys()].filter((n) => !TOOLS_MCP.includes(n));
  if (desconocidas.length) console.log(`  (otras: ${desconocidas.join(', ')})`);

  // ── Carencias conocidas ───────────────────────────────────────────────────
  const porCarencia = new Map();
  for (const f of filas) {
    for (const c of f.carencias) {
      if (!porCarencia.has(c)) porCarencia.set(c, []);
      porCarencia.get(c).push(f);
    }
  }
  console.log('\nPreguntas que tocan carencias conocidas del MCP');
  if (porCarencia.size === 0) {
    console.log('  Ninguna. Nadie ha preguntado por lo que el MCP no sabe hacer.');
  } else {
    for (const [c, fs_] of [...porCarencia].sort((a, b) => b[1].length - a[1].length)) {
      const malas = fs_.filter((f) => f.clase !== 'ok').length;
      console.log(`  ${c.padEnd(22)} ${String(fs_.length).padStart(3)} preguntas (${malas} no resueltas)`);
    }
  }

  // ── El detalle que hay que leer a mano ────────────────────────────────────
  const sospechosas = filas.filter((f) => (verTodas ? true : f.clase !== 'ok'));
  console.log(`\n${'='.repeat(78)}`);
  console.log(`PREGUNTAS A REVISAR (${sospechosas.length})`);
  console.log('='.repeat(78));

  for (const f of sospechosas) {
    console.log(`\n[${f.clase}] ${f.fecha}${f.carencias.length ? `  carencias: ${f.carencias.join(', ')}` : ''}`);
    console.log(`  P: ${f.pregunta.slice(0, 200)}`);
    console.log(`  R: ${f.respuesta.slice(0, 240).replace(/\n/g, ' ')}`);
    console.log(`  tools: ${f.tools.length ? f.tools.join(' -> ') : '(ninguna)'}`);
  }

  console.log(`\n${'='.repeat(78)}`);
  console.log('Cómo leer esto: "evasiva" con carencia marcada es una tool que falta.');
  console.log('"evasiva" sin carencia es una tool que existe pero el agente no encontró.');
  console.log('"sin-tools" en una pregunta de datos es el caso más grave.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

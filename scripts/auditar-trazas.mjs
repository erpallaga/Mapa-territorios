// Audita las trazas de Langfuse del agente `ask-territorios` buscando preguntas
// que no se hayan respondido bien, y en particular las que fallan por falta de
// tool en el servidor MCP.
//
// La pregunta que contesta: "de todo lo que la gente ha preguntado, ¿qué se ha
// quedado sin respuesta, y cuánto de eso es culpa de que no exista la tool?".
//
// El matiz que hace falta el script: los fallos que importan NO son los que
// salen en rojo en Langfuse. Una negativa o un error de tool se ven a simple
// vista en la UI. Lo que no se ve es la traza verde en la que el modelo, a
// falta de la tool correcta, tiró de la más parecida y devolvió una cifra
// plausible sobre la ventana de fechas equivocada. Por eso se clasifica por
// síntoma y se imprime la pregunta entera: esto se lee, no se resume.
//
// Uso:
//   npm run auditar-trazas
//   npm run auditar-trazas -- --dias 90
//   npm run auditar-trazas -- --detalle   # + pregunta/respuesta completas
//   npm run auditar-trazas -- --json      # volcado crudo para analizar aparte
//
// Autenticación: LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY (las mismas que usan
// `langfuse-seed-prompt.mjs` y la edge function), o ninguna de las dos si un
// proxy de salida ya inyecta la cabecera Authorization. Sin dependencias: el
// fetch de Node basta.

const args = process.argv.slice(2);
const detalle = args.includes('--detalle');
const comoJson = args.includes('--json');
const dias = Number(valorDe('--dias') ?? 180);
const limitePaginas = Number(valorDe('--max-paginas') ?? 20);

function valorDe(flag) {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}

const BASE_URL = (process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com').replace(/\/$/, '');
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

// Dos formas de autenticarse, y el script acepta las dos:
//
//  a) Las claves en el entorno (un `.env` local, o las variables del entorno
//     cloud). El script construye la cabecera Basic él mismo.
//  b) Sin claves: un proxy de salida inyecta la cabecera Authorization por
//     nosotros — es el caso de una "API credential" de un entorno cloud de
//     Claude Code, donde la secret key nunca entra en la sesión. Entonces hay
//     que NO mandar cabecera propia, para no pisar la que inyecta el proxy.
const AUTH = PUBLIC_KEY && SECRET_KEY
    ? 'Basic ' + Buffer.from(`${PUBLIC_KEY}:${SECRET_KEY}`).toString('base64')
    : null;

if (!AUTH) {
    console.error('Sin LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY en el entorno:');
    console.error('se asume que un proxy inyecta la cabecera Authorization.');
    console.error('Si no es el caso, pon las claves en un .env y repite.\n');
}

// Las 8 tools que registra mcp-server/tools.js. Sirve para detectar las que
// nadie llama nunca: o sobran, o su descripción no las hace encontrables.
const TOOLS_MCP = [
    'territorios_listar',
    'territorios_buscar_por_id',
    'territorios_vencidos',
    'territorios_estadisticas',
    'territorios_buscar_por_publicador',
    'territorios_actividad',
    'publicadores_listar',
    'territorios_sin_trabajar',
];

// Periodos de dates.js que son año NATURAL. Si la pregunta hablaba del año de
// servicio (1 sep - 31 ago) y la tool se llamó con uno de estos, la respuesta
// mira una ventana distinta de la que se preguntó.
const PERIODOS_ANYO_NATURAL = new Set(['este_ano', 'ano_pasado', 'ultimo_ano']);

const RE_ANYO_SERVICIO = /a[ñn]o\s+de\s+servicio|a[ñn]o\s+servicio|campa[ñn]a|curso\s+\d{2}\s*[/-]\s*\d{2}/i;
const RE_ESTE_ANYO = /\beste\s+a[ñn]o\b|\bel\s+a[ñn]o\s+pasado\b|\ben\s+lo\s+que\s+va\s+de\s+a[ñn]o\b/i;

// Fórmulas con las que el modelo se escurre. No prueban que falte una tool,
// pero son el sitio donde mirar primero.
const RE_EVASIVA = /no\s+(puedo|tengo|dispongo|consta|encuentro|hay)\b|no\s+se\s+puede|no\s+est[áa]\s+disponible|lo\s+siento|no\s+dispongo\s+de|no\s+tengo\s+(acceso|forma|manera)/i;

async function api(path, params = {}) {
    const url = new URL(`${BASE_URL}${path}`);
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
        headers: { Accept: 'application/json', ...(AUTH ? { Authorization: AUTH } : {}) },
    });
    if (!res.ok) {
        const cuerpo = await res.text().catch(() => '');
        throw new Error(`${res.status} ${res.statusText} en ${path}\n${cuerpo.slice(0, 500)}`);
    }
    return res.json();
}

/** Todas las trazas del agente desde hace `dias`, paginando hasta agotarlas. */
async function traerTrazas() {
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
    const todas = [];

    for (let page = 1; page <= limitePaginas; page++) {
        const r = await api('/api/public/traces', {
            name: 'ask-territorios',
            fromTimestamp: desde,
            page,
            limit: 100,
        });
        const lote = r?.data ?? [];
        todas.push(...lote);
        const totalPaginas = r?.meta?.totalPages ?? 1;
        if (lote.length === 0 || page >= totalPaginas) break;
    }
    return todas;
}

/** Observaciones de una traza. El endpoint de detalle ya las trae completas. */
async function traerObservaciones(traceId) {
    try {
        const t = await api(`/api/public/traces/${traceId}`);
        if (Array.isArray(t?.observations) && typeof t.observations[0] === 'object') {
            return t.observations;
        }
    } catch {
        // cae al endpoint de observaciones
    }
    const r = await api('/api/public/observations', { traceId, limit: 100 });
    return r?.data ?? [];
}

function texto(v) {
    if (v == null) return '';
    return typeof v === 'string' ? v : JSON.stringify(v);
}

function comoObjeto(v) {
    if (v && typeof v === 'object') return v;
    if (typeof v === 'string') {
        try { return JSON.parse(v); } catch { return null; }
    }
    return null;
}

/** Clasifica una traza en sus síntomas. Una traza puede tener varios. */
function analizar(traza, observaciones) {
    const generacion = observaciones.find((o) => o.name === 'anthropic-messages');
    const tools = observaciones.filter(
        (o) => String(o.type || '').toUpperCase() === 'TOOL' || TOOLS_MCP.includes(o.name),
    );

    const meta = generacion?.metadata ?? {};
    const stopReason = String(meta.stop_reason ?? '');
    const pregunta = texto(traza.input);
    const respuesta = texto(traza.output);

    const llamadas = tools.map((o) => ({
        nombre: o.metadata?.tool_name || o.name,
        args: comoObjeto(o.input) ?? {},
        error: o.metadata?.is_error === true || o.metadata?.is_error === 'true',
    }));

    const sintomas = [];

    if (stopReason === 'refusal' || respuesta === '[refusal]') sintomas.push('NEGATIVA');
    if (String(traza.level || '').toUpperCase() === 'ERROR' || generacion?.level === 'ERROR') {
        sintomas.push('ERROR');
    }
    if (stopReason === 'max_tokens') sintomas.push('TRUNCADA');
    if (llamadas.some((l) => l.error)) sintomas.push('TOOL_ERROR');
    if (llamadas.length === 0 && pregunta) sintomas.push('SIN_TOOLS');

    // El caso silencioso: se preguntó por el año de servicio y se miró el natural.
    const preguntaAnyoServicio = RE_ANYO_SERVICIO.test(pregunta) || RE_ESTE_ANYO.test(pregunta);
    const usoAnyoNatural = llamadas.some((l) => PERIODOS_ANYO_NATURAL.has(String(l.args?.periodo)));
    if (preguntaAnyoServicio && usoAnyoNatural) sintomas.push('VENTANA_EQUIVOCADA');
    // Preguntó por el año de servicio y ni siquiera acotó fechas.
    if (preguntaAnyoServicio && llamadas.length > 0 && !llamadas.some((l) => l.args?.periodo || l.args?.mes || l.args?.desde)) {
        sintomas.push('ANYO_SERVICIO_SIN_RANGO');
    }

    if (llamadas.length > 0 && RE_EVASIVA.test(respuesta)) sintomas.push('EVASIVA_CON_TOOLS');

    return {
        id: traza.id,
        fecha: traza.timestamp,
        pregunta,
        respuesta,
        stopReason,
        llamadas,
        sintomas,
    };
}

function encabezado(t) {
    return `${String(t.fecha || '').slice(0, 16).replace('T', ' ')}  ${t.pregunta.replace(/\s+/g, ' ').slice(0, 110)}`;
}

async function main() {
    console.log(`Langfuse: ${BASE_URL} — trazas 'ask-territorios' de los últimos ${dias} días\n`);

    const trazas = await traerTrazas();
    if (trazas.length === 0) {
        console.log('No hay ninguna traza en ese rango. Prueba con --dias 365.');
        return;
    }
    console.log(`${trazas.length} trazas. Descargando observaciones...\n`);

    const analizadas = [];
    for (const t of trazas) {
        const obs = await traerObservaciones(t.id);
        analizadas.push(analizar(t, obs));
    }

    if (comoJson) {
        console.log(JSON.stringify(analizadas, null, 2));
        return;
    }

    // ── Uso de tools ────────────────────────────────────────────────────────
    const uso = new Map(TOOLS_MCP.map((n) => [n, 0]));
    let totalLlamadas = 0;
    for (const a of analizadas) {
        for (const l of a.llamadas) {
            uso.set(l.nombre, (uso.get(l.nombre) ?? 0) + 1);
            totalLlamadas++;
        }
    }

    console.log('## Uso de tools\n');
    for (const [nombre, n] of [...uso].sort((a, b) => b[1] - a[1])) {
        const pct = totalLlamadas ? ((n / totalLlamadas) * 100).toFixed(1) : '0.0';
        console.log(`  ${String(n).padStart(4)}  ${pct.padStart(5)}%  ${nombre}${n === 0 ? '   <-- nunca llamada' : ''}`);
    }
    const sinTools = analizadas.filter((a) => a.llamadas.length === 0).length;
    console.log(`\n  ${totalLlamadas} llamadas en ${analizadas.length} trazas ` +
        `(${(totalLlamadas / analizadas.length).toFixed(2)} por traza; ${sinTools} trazas sin ninguna).\n`);

    // ── Síntomas ────────────────────────────────────────────────────────────
    const orden = [
        ['VENTANA_EQUIVOCADA', 'Preguntó por el año de servicio, se miró el año natural (respuesta plausible y falsa)'],
        ['ANYO_SERVICIO_SIN_RANGO', 'Preguntó por el año de servicio y no se acotaron fechas'],
        ['NEGATIVA', 'El modelo se negó a responder (stop_reason: refusal)'],
        ['ERROR', 'La traza acabó en error'],
        ['TOOL_ERROR', 'Alguna tool devolvió isError'],
        ['TRUNCADA', 'Respuesta cortada por MAX_TOKENS (1024)'],
        ['SIN_TOOLS', 'Respondió sin llamar a ninguna tool'],
        ['EVASIVA_CON_TOOLS', 'Llamó a tools pero la respuesta es evasiva'],
    ];

    console.log('## Síntomas\n');
    for (const [clave, desc] of orden) {
        const casos = analizadas.filter((a) => a.sintomas.includes(clave));
        console.log(`  ${String(casos.length).padStart(4)}  ${clave} — ${desc}`);
    }

    console.log('\n## Casos, por síntoma\n');
    for (const [clave, desc] of orden) {
        const casos = analizadas.filter((a) => a.sintomas.includes(clave));
        if (casos.length === 0) continue;
        console.log(`### ${clave} (${casos.length}) — ${desc}\n`);
        for (const c of casos) {
            console.log(`- ${encabezado(c)}`);
            if (c.llamadas.length > 0) {
                console.log(`    tools: ${c.llamadas.map((l) => `${l.nombre}(${JSON.stringify(l.args)})`).join(' · ')}`);
            }
            if (detalle) {
                console.log(`    P: ${c.pregunta}`);
                console.log(`    R: ${c.respuesta.replace(/\s+/g, ' ').slice(0, 600)}`);
            }
        }
        console.log('');
    }

    // ── Todo lo preguntado ──────────────────────────────────────────────────
    // El listado importa tanto como la clasificación: lo que falta se ve
    // leyendo qué pregunta la gente, no solo qué falló.
    console.log('## Todas las preguntas (para leer a mano)\n');
    const vistas = new Map();
    for (const a of analizadas) {
        const clave = a.pregunta.replace(/\s+/g, ' ').trim().toLowerCase();
        if (!vistas.has(clave)) vistas.set(clave, { texto: a.pregunta.replace(/\s+/g, ' ').trim(), n: 0, sintomas: new Set() });
        const v = vistas.get(clave);
        v.n++;
        for (const s of a.sintomas) v.sintomas.add(s);
    }
    for (const v of [...vistas.values()].sort((a, b) => b.n - a.n)) {
        const marca = v.sintomas.size > 0 ? `  [${[...v.sintomas].join(',')}]` : '';
        console.log(`  ${String(v.n).padStart(3)}x  ${v.texto}${marca}`);
    }
}

main().catch((err) => {
    console.error('\nFalló la auditoría:', err.message);
    process.exit(1);
});

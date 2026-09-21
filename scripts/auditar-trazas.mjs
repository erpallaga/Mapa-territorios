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
//
// LANGFUSE v4: este script leía por GET /api/public/traces y
// GET /api/public/observations, que son endpoints de v3 y Langfuse Cloud apaga
// el 16 de noviembre de 2026. Ahora lee por GET /api/public/v2/observations, que
// además es el único camino de lectura en tiempo real (el resto de la API
// pública puede retrasar los datos unos diez minutos).
//
// El modelo de datos cambia con él: en v4 no hay un objeto "traza" aparte con su
// propio input/output, sino una observación RAÍZ (`isRootObservation`) que los
// lleva. Así que aquí una "traza" es su observación raíz más sus descendientes.
//
// El histórico NO se pierde al cambiar de endpoint: se comprobó el 2026-09-21
// comparando las dos listas, y todas las trazas de producción que devolvía
// GET /api/public/traces aparecen también por la v2, con su input y su output en
// la observación raíz. Lo que sí se queda fuera es lo que se ingiera SIN la
// cabecera `x-langfuse-ingestion-version: 4` a partir de ahora: eso no llega al
// modelo de lectura de v4 ni pasados 25 minutos. Por eso el exportador la manda.

// PRIVACIDAD: la salida lleva preguntas reales de la congregación y nombres de
// publicadores. Este repositorio es público: no commitees nunca lo que imprime
// este script, ni entero ni a trozos. El script sí, su salida no.
//
// Node >= 22.21 ignora HTTPS_PROXY en su `fetch` salvo que NODE_USE_ENV_PROXY=1
// esté puesto ANTES de arrancar, así que no vale con asignarlo aquí: hay que
// relanzarse. Sin esto, en un entorno con proxy de salida todas las llamadas
// mueren con un 403 del proxy en vez de llegar a Langfuse.
if (!process.env.NODE_USE_ENV_PROXY && (process.env.HTTPS_PROXY || process.env.https_proxy)) {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, process.argv.slice(1), {
        stdio: 'inherit',
        env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
    });
    process.exit(r.status ?? 1);
}

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

// Fórmulas con las que el modelo se escurre. Solo incapacidad del agente: "no
// tengo acceso", "no puedo". Ojo con confundirlas con un dato legítimamente
// vacío ("no hay ningún publicador con ese nombre", "no tiene territorios"),
// que es una respuesta correcta, no una evasiva; por eso no se buscan aquí.
const RE_EVASIVA = /no\s+(puedo|s[ée])\b|no\s+se\s+puede|no\s+est[áa]\s+disponible|no\s+dispongo\s+de|no\s+tengo\s+(acceso|forma|manera|informaci[óo]n|datos)|fuera\s+de\s+mi\s+alcance/i;

// Preguntas que ninguna tool puede contestar hoy: el MCP solo ve la hoja, nunca
// la geometría de los KML, y no agrega `numViviendas`.
//
// OJO con los colores: "cuántos hay en verde" NO es geometría. Las tools ya
// traducen verde=libre y rojo=asignado, así que una pregunta por el color se
// contesta perfectamente. Estaban aquí dentro y marcaban como irrespondible
// justo lo que se acababa de hacer respondible — es decir, corrompían la
// auditoría siguiente. Viven ahora en RE_COLOR, que solo salta si además NO se
// llamó a ninguna tool, que es el único caso en que el color fue un problema.
const RE_GEOMETRIA = /\bcalles?\b|\bcerca\b|\bcercanos?\b|colind|\blimita\b|\balrededor\b|\bvecinos?\b|\bdibuj/i;
const RE_COLOR = /\bverde[s]?\b|\brojo[s]?\b|\bcolor(es)?\b/i;
const RE_VIVIENDAS = /vivienda|\bpisos?\b|\bpuertas\b|\bcasas\b/i;

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

/**
 * Recorre GET /api/public/v2/observations, que pagina por cursor opaco: el
 * `meta.cursor` de una respuesta es el `cursor` de la siguiente, y no venir es
 * la señal de que se acabó.
 */
async function traerObservacionesPaginando(params) {
    const todas = [];
    let cursor;

    for (let pagina = 1; pagina <= limitePaginas; pagina++) {
        const r = await api('/api/public/v2/observations', { ...params, limit: 100, cursor });
        const lote = r?.data ?? [];
        todas.push(...lote);
        cursor = r?.meta?.cursor;
        if (lote.length === 0 || !cursor) break;
    }
    return todas;
}

/**
 * Las raíces de las trazas del agente desde hace `dias`. En v4 la raíz ES la
 * traza a efectos de pregunta y respuesta: `input` y `output` son suyos.
 */
async function traerTrazas() {
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();

    const raices = await traerObservacionesPaginando({
        name: 'ask-territorios',
        isRootObservation: true,
        fromStartTime: desde,
        fields: 'core,basic,io,metadata,trace_context',
    });

    // El resto del script habla de trazas, así que se le da la forma que espera.
    return raices.map((o) => ({
        id: o.traceId,
        timestamp: o.startTime,
        input: o.input,
        output: o.output,
        level: o.level,
    }));
}

/** Las observaciones de una traza, raíz incluida. */
async function traerObservaciones(traceId) {
    return traerObservacionesPaginando({
        traceId,
        fields: 'core,basic,io,metadata,model,usage',
    });
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

/**
 * Un año de servicio va del 1 de septiembre al 31 de agosto. Si alguien teclea
 * ese rango a mano en `desde`/`hasta` es que quería un periodo que no existe en
 * `PERIODOS`: la prueba de que la ventana hace falta, aunque la respuesta salga
 * bien porque el usuario hizo el trabajo del agente.
 */
function esRangoAnyoServicio(args) {
    const d = String(args?.desde ?? '');
    const h = String(args?.hasta ?? '');
    return /^\d{4}-09-01$/.test(d) && /^\d{4}-08-31$/.test(h);
}

/** Clasifica una traza en sus síntomas. Una traza puede tener varios. */
function analizar(traza, observaciones) {
    // Langfuse devuelve las observaciones sin ordenar: hay que ordenarlas por
    // startTime o la secuencia de tools que se imprime no es la que ocurrió.
    const obs = [...observaciones].sort(
        (a, b) => new Date(a.startTime) - new Date(b.startTime),
    );

    // Puede haber más de una generación por traza (varias vueltas del bucle de
    // tools), así que no vale con quedarse con la primera: para stop_reason
    // manda la última, y para "¿se truncó alguna?" mandan todas.
    const generaciones = obs.filter(
        (o) => String(o.type || '').toUpperCase() === 'GENERATION' || o.name === 'anthropic-messages',
    );
    const ultima = generaciones[generaciones.length - 1];
    const tools = obs.filter(
        (o) => String(o.type || '').toUpperCase() === 'TOOL' || TOOLS_MCP.includes(o.name),
    );

    const stopReason = String(ultima?.metadata?.stop_reason ?? '');
    const pregunta = texto(traza.input);
    const respuesta = texto(traza.output);

    const llamadas = tools.map((o) => ({
        nombre: o.metadata?.tool_name || o.name,
        args: comoObjeto(o.input) ?? {},
        // El resultado llega como bloques de contenido de Anthropic
        // ([{type:'text',text:...}]), no como string suelto.
        salida: Array.isArray(comoObjeto(o.output))
            ? comoObjeto(o.output).map((b) => b?.text ?? '').join('\n')
            : texto(o.output),
        error: o.metadata?.is_error === true || o.metadata?.is_error === 'true',
    }));

    const sintomas = [];

    if (stopReason === 'refusal' || respuesta === '[refusal]') sintomas.push('NEGATIVA');
    if (String(traza.level || '').toUpperCase() === 'ERROR' || generaciones.some((g) => g.level === 'ERROR')) {
        sintomas.push('ERROR');
    }
    if (generaciones.some((g) => g.metadata?.stop_reason === 'max_tokens')) sintomas.push('TRUNCADA');
    if (llamadas.some((l) => l.error)) sintomas.push('TOOL_ERROR');
    if (llamadas.length === 0 && pregunta) sintomas.push('SIN_TOOLS');

    // El caso silencioso: se preguntó por el año de servicio y se miró el natural.
    const preguntaAnyoServicio = RE_ANYO_SERVICIO.test(pregunta) || RE_ESTE_ANYO.test(pregunta);
    const usoAnyoNatural = llamadas.some((l) => PERIODOS_ANYO_NATURAL.has(String(l.args?.periodo)));
    if (preguntaAnyoServicio && usoAnyoNatural) sintomas.push('VENTANA_EQUIVOCADA');
    if (preguntaAnyoServicio && llamadas.length > 0 && !llamadas.some((l) => l.args?.periodo || l.args?.mes || l.args?.desde)) {
        sintomas.push('ANYO_SERVICIO_SIN_RANGO');
    }
    // La misma carencia, vista por el otro lado: el usuario tecleó el 1-sep/31-ago
    // a mano porque no hay `periodo: 'anyo_servicio'` que pedir.
    if (llamadas.some((l) => esRangoAnyoServicio(l.args))) sintomas.push('ANYO_SERVICIO_A_MANO');

    // `territorios_buscar_por_publicador` casa por subcadena ("Mora" encuentra
    // "Rocamora") y, cuando casa con varias personas, SUMA sus cifras en un solo
    // resumen. Avisa en `nombresCoincidentes`, pero los totales que devuelve ya
    // vienen mezclados, así que el modelo los atribuye a una sola persona.
    for (const l of llamadas) {
        const m = /El nombre coincide con (\d+) publicadores?: ([^\n]+)/.exec(l.salida || '');
        if (m && Number(m[1]) > 1) {
            sintomas.push('AMBIGUEDAD_AGREGADA');
            l.personasMezcladas = m[2].trim();
        }
    }

    if (RE_GEOMETRIA.test(pregunta)) sintomas.push('PREGUNTA_GEOMETRIA');
    // Solo cuenta como problema de vocabulario si el color dejó al modelo sin
    // saber qué tool usar; si llamó a una, la pregunta se resolvió.
    if (RE_COLOR.test(pregunta) && llamadas.length === 0) sintomas.push('VOCABULARIO_COLOR');
    if (RE_VIVIENDAS.test(pregunta)) sintomas.push('PREGUNTA_VIVIENDAS');
    if (llamadas.length > 0 && RE_EVASIVA.test(respuesta)) sintomas.push('EVASIVA_CON_TOOLS');

    return {
        id: traza.id,
        fecha: traza.timestamp,
        pregunta,
        respuesta,
        stopReason,
        llamadas,
        sintomas: [...new Set(sintomas)],
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
        ['ANYO_SERVICIO_A_MANO', 'Tecleó el 1-sep/31-ago a mano: el periodo que falta en PERIODOS'],
        ['AMBIGUEDAD_AGREGADA', 'El nombre casó con varias personas y la tool sumó sus cifras en una'],
        ['PREGUNTA_GEOMETRIA', 'Preguntó por calles/cercanía/colindancia: ninguna tool ve la geometría'],
        ['VOCABULARIO_COLOR', 'Preguntó por un color y no se llamó a ninguna tool: falta el término en las descripciones'],
        ['PREGUNTA_VIVIENDAS', 'Preguntó por viviendas: ninguna tool las agrega'],
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
            for (const l of c.llamadas) {
                if (l.personasMezcladas) console.log(`    ⚠️ cifras sumadas de: ${l.personasMezcladas}`);
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

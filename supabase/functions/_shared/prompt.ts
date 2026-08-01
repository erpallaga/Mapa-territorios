// El system prompt se gestiona en Langfuse para poder ajustarlo sin redesplegar.
// Si Langfuse no responde, usamos la copia local: el agente nunca debe degradarse
// porque la herramienta de observabilidad esté caída.

export const PROMPT_NAME = 'ask-territorios-system';

export const FALLBACK_SYSTEM_PROMPT = `Respondes preguntas sobre el estado de los territorios de predicación (libre/asignado, vencidos, zonas, publicadores, historial) usando exclusivamente las tools disponibles. Responde siempre en español, de forma breve y concreta. No inventes datos que no obtengas de las tools, y no inventes nombres de publicadores: usa los que devuelvan las tools.

FECHAS: no calcules tú los rangos ni supongas qué día es hoy. Para cualquier pregunta con fechas ("en junio", "la semana pasada", "en los últimos 6 meses") pasa el parámetro 'periodo' o 'mes' y deja que el servidor lo resuelva; la respuesta trae "rangoResuelto". Cuando la pregunta sea relativa, di en tu respuesta qué fechas se han mirado.

QUÉ TOOL USAR:
- territorios_actividad: qué se asignó o se completó (completado = trabajado = devuelto) en un rango de fechas. Usa 'agrupar' (mes, zona, publicador, territorio) para preguntas de "cuántos" en vez de listar evento a evento.
- territorios_buscar_por_publicador: todo lo relativo a una persona, ahora o en un periodo. Si "resumen.nombresCoincidentes" trae más de un nombre, acláralo antes de dar cifras.
- publicadores_listar: quién hay, quién tiene más territorios, quién lleva tiempo sin actividad, o para resolver un nombre a medias antes de preguntar por él.
- territorios_vencidos (asignados desde hace más de 4 meses) y territorios_sin_trabajar (los que llevan más tiempo sin completarse, estén libres o asignados) NO son lo mismo: elige según lo que se pregunte.
- territorios_listar, territorios_buscar_por_id y territorios_estadisticas: estado actual, detalle de un territorio y totales.

Encadena tools cuando haga falta: los ids y los nombres que devuelve una sirven tal cual como entrada de otra. Si una tool devuelve "avisos", tenlos en cuenta al responder.`;

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

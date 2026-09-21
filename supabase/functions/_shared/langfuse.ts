// Envío de trazas a Langfuse mediante OTLP/HTTP con codificación JSON.
// Sin dependencias a propósito: esta función corre en el edge runtime de Deno
// y la telemetría nunca debe añadir peso ni puntos de fallo a la respuesta.
//
// Regla invariable: NADA aquí puede lanzar una excepción hacia el llamante.
// Si Langfuse falla, el usuario no debe enterarse.

// NOTA (verificado en Task 1, scripts/langfuse-otel-spike.mjs): el tipo 'tool'
// SÍ está soportado por esta instancia de Langfuse Cloud EU — se conserva como
// observación propia (la API lo devuelve como "TOOL"), no se degrada a un span
// genérico. Además `parentSpanId` produce anidamiento real de observaciones.
// Por eso Task 4 puede usar 'tool' directamente para reconstruir las tool calls.
//
// LANGFUSE v4 — tres reglas que se comprobaron contra la instancia real mandando
// la misma traza de las dos formas y leyéndola por GET /api/public/v2/observations:
//
//  1. Un exportador propio TIENE que mandar `x-langfuse-ingestion-version: 4`.
//     Sin esa cabecera la petición responde 200 igual — devuelve incluso el
//     trabajo encolado — pero la traza NO llega al modelo de lectura de v4: se
//     probó dos veces con dos payloads distintos y seguían sin aparecer 25
//     minutos después, mientras que la misma traza con la cabecera aparecía en
//     segundos. El fallo es silencioso: ni error, ni traza.
//  2. `langfuse.trace.input` / `langfuse.trace.output` están deprecados y por el
//     camino v4 se DESCARTAN: la raíz llega con input y output a null. Esto y lo
//     anterior van juntos a la fuerza — poner sólo la cabecera y dejar los
//     atributos viejos es el único cambio que EMPEORA las cosas, porque hasta
//     ahora la ingesta v3 sí rellenaba el input/output de la raíz. El
//     input/output de conjunto va en `langfuse.observation.input` /
//     `langfuse.observation.output` de la observación raíz, y la raíz se marca
//     con `langfuse.internal.is_app_root`.
//  3. Lo que identifica y agrupa (usuario, sesión, nombre, tags, entorno,
//     metadatos de traza) va en TODAS las observaciones, no sólo en la raíz. Si
//     `session.id` no viaja también en la generación, el coste de esa generación
//     no cuenta para el coste de la sesión. Es lo que hace el SDK con
//     `propagateAttributes`, y aquí lo hacen `propagatedAttrs` y `propagar()`.
//
// El tipo 'agent' y compañía existen en v4; aquí sólo se declaran los que se usan.
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

// Ver la regla 1 de la cabecera. Es obligatoria para exportadores propios.
const INGESTION_VERSION = '4';

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
    // Los tags son una lista y Langfuse los quiere como arrayValue de OTLP: si se
    // mandan como el JSON '["a","b"]' llegan como un único tag con corchetes.
    if (Array.isArray(value)) {
        return {
            key,
            value: { arrayValue: { values: value.map((v) => ({ stringValue: stringify(v) })) } },
        };
    }
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

    // Dos grupos distintos, y la diferencia importa (regla 3 de la cabecera):
    //
    //  - `rootAttrs` describe SOLO la observación raíz: su tipo, su input/output
    //    de conjunto, y su nivel si la petición acabó mal.
    //  - `propagatedAttrs` identifica y agrupa, y se copia en TODAS las
    //    observaciones al hacer flush. `session.id` en la generación es lo que
    //    hace que su coste cuente para el coste de la sesión.
    const rootAttrs: OtlpAttribute[] = [
        attr('langfuse.observation.type', 'span'),
        attr('langfuse.internal.is_app_root', true),
    ];
    const propagatedAttrs: OtlpAttribute[] = [attr('langfuse.trace.name', opts.name)];
    // `user.id` y `session.id` son los nombres de la convención de OpenTelemetry,
    // que es lo que emite el SDK de Langfuse v4. Los antiguos `langfuse.user.id` y
    // `langfuse.session.id` siguen aceptándose como alias de compatibilidad, pero
    // no son los que documenta v4.
    if (opts.userId) propagatedAttrs.push(attr('user.id', opts.userId));
    if (opts.sessionId) propagatedAttrs.push(attr('session.id', opts.sessionId));
    if (opts.tags?.length) propagatedAttrs.push(attr('langfuse.trace.tags', opts.tags));
    if (opts.environment) propagatedAttrs.push(attr('langfuse.environment', opts.environment));

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

        // El input/output de conjunto de la petición. En v4 vive en la observación
        // raíz, no en la traza: `langfuse.trace.input`/`output` están deprecados y
        // se descartan en la ingesta (regla 2 de la cabecera).
        setTrace(a: { input?: unknown; output?: unknown; metadata?: Record<string, unknown> }) {
            try {
                if (a.input !== undefined) rootAttrs.push(attr('langfuse.observation.input', a.input));
                if (a.output !== undefined) rootAttrs.push(attr('langfuse.observation.output', a.output));
                // Los metadatos de traza sí siguen siendo `langfuse.trace.metadata.*`,
                // y se propagan a todas las observaciones para poder filtrar por ellos.
                for (const [k, v] of Object.entries(a.metadata ?? {})) {
                    propagatedAttrs.push(attr(`langfuse.trace.metadata.${k}`, v));
                }
            } catch (err) {
                console.warn('[langfuse] failed to set trace attributes', err);
            }
        },

        setError(message: string) {
            rootAttrs.push(attr('langfuse.observation.level', 'ERROR'));
            rootAttrs.push(attr('langfuse.observation.status_message', message));
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
                    attributes: rootAttrs,
                };

                // Se copian aquí y no al crear cada span porque `setTrace` puede
                // añadir metadatos después de que una observación ya haya acabado.
                // Si una observación trae su propia clave, gana la suya.
                const propagar = (s: PendingSpan): OtlpAttribute[] => {
                    const propias = new Set(s.attributes.map((a) => a.key));
                    return [...s.attributes, ...propagatedAttrs.filter((a) => !propias.has(a.key))];
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
                                attributes: propagar(s),
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
                        // Sin esto la traza se ingiere por el camino v3 y no
                        // aparece en las lecturas v4 (regla 1 de la cabecera).
                        'x-langfuse-ingestion-version': INGESTION_VERSION,
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

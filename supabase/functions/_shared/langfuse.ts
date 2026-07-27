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

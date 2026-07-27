import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createTrace } from "../_shared/langfuse.ts";
import { getSystemPrompt } from "../_shared/prompt.ts";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Solo lectura: este modelo únicamente puede consultar el estado de los
// territorios a través de las tools del servidor MCP remoto (ver api/mcp.js).
const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 1024;
const MCP_BETA_HEADER = 'mcp-client-2025-11-20';
const MAX_MESSAGES = 20;
const MAX_TOTAL_CHARS = 12000;

// El sessionId sólo agrupa la conversación en Langfuse. Viene del cliente, así
// que se valida la forma y se descarta si no encaja: nunca se usa para autorizar.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Ejecuta el flush de telemetría sin bloquear la respuesta al usuario.
function fireAndForget(promise: Promise<unknown>) {
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (runtime?.waitUntil) {
        runtime.waitUntil(promise);
    } else {
        promise.catch(() => { });
    }
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'No authorization header' }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

        // Cliente con el JWT del usuario que llama: reutiliza exactamente la
        // misma autenticación/RLS que ya usa el resto de la app.
        const userClient = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        });

        const { data: { user }, error: userError } = await userClient.auth.getUser();
        if (userError || !user) {
            return new Response(JSON.stringify({ error: 'Unauthorized user token', details: userError }), {
                status: 401,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const { data: profile, error: profileError } = await userClient
            .from('profiles')
            .select('is_active')
            .eq('id', user.id)
            .single();

        if (profileError || profile?.is_active !== true) {
            return new Response(JSON.stringify({ error: 'Active account required' }), {
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const { messages, sessionId: rawSessionId } = await req.json();
        const sessionId = typeof rawSessionId === 'string' && UUID_RE.test(rawSessionId)
            ? rawSessionId
            : undefined;

        if (!Array.isArray(messages) || messages.length === 0) {
            return new Response(JSON.stringify({ error: 'messages array is required' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
        if (messages.length > MAX_MESSAGES) {
            return new Response(JSON.stringify({ error: `too many messages (max ${MAX_MESSAGES})` }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        let totalChars = 0;
        for (const m of messages) {
            if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || m.content.trim() === '') {
                return new Response(JSON.stringify({ error: 'each message needs a role (user|assistant) and non-empty content' }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
            }
            totalChars += m.content.length;
        }
        if (totalChars > MAX_TOTAL_CHARS) {
            return new Response(JSON.stringify({ error: `conversation is too long (max ${MAX_TOTAL_CHARS} characters total)` }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
        if (messages[messages.length - 1].role !== 'user') {
            return new Response(JSON.stringify({ error: 'the last message must be from the user' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // A partir de aquí la petición es válida y vamos a gastar tokens, así que
        // merece la pena trazarla. Las peticiones mal formadas no se trazan.
        const trace = createTrace({
            name: 'ask-territorios',
            userId: user.id,
            sessionId,
            tags: ['ask-territorios'],
            environment: Deno.env.get('LANGFUSE_ENVIRONMENT') ?? 'production',
        });
        const lastUserMessage = messages[messages.length - 1].content.trim();
        trace.setTrace({
            input: lastUserMessage,
            metadata: { message_count: messages.length },
        });

        const promptSpan = trace.startSpan('prompt-fetch', 'span');
        const systemPrompt = await getSystemPrompt();
        if (systemPrompt.fetched) {
            promptSpan.end({
                output: { name: systemPrompt.name, version: systemPrompt.version },
                metadata: { fallback: systemPrompt.name === null },
            });
        }

        const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')!;
        const mcpServerUrl = Deno.env.get('MCP_SERVER_URL')!;
        const mcpSharedSecret = Deno.env.get('MCP_SHARED_SECRET')!;

        // El conector MCP de la API de Anthropic llama él mismo a las tools
        // del servidor remoto (api/mcp.js) dentro de esta misma petición —
        // no hace falta un bucle manual de tool-use en esta función.
        const generation = trace.startSpan('anthropic-messages', 'generation');
        const anthropicMessages = messages.map((m: { role: string; content: string }) => ({
            role: m.role,
            content: m.content.trim(),
        }));

        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': anthropicApiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-beta': MCP_BETA_HEADER,
            },
            body: JSON.stringify({
                model: MODEL,
                max_tokens: MAX_TOKENS,
                system: systemPrompt.text,
                mcp_servers: [{
                    type: 'url',
                    name: 'territorios',
                    url: mcpServerUrl,
                    authorization_token: mcpSharedSecret,
                }],
                tools: [{ type: 'mcp_toolset', mcp_server_name: 'territorios' }],
                messages: anthropicMessages,
            }),
        });

        if (!anthropicResponse.ok) {
            const errText = await anthropicResponse.text();
            console.error('Anthropic API error:', anthropicResponse.status, errText);
            generation.end({
                model: MODEL,
                input: anthropicMessages,
                level: 'ERROR',
                statusMessage: `Anthropic ${anthropicResponse.status}: ${errText}`,
            });
            trace.setError(`Anthropic ${anthropicResponse.status}`);
            fireAndForget(trace.flush());
            return new Response(JSON.stringify({ error: 'Failed to get an answer' }), {
                status: 502,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const result = await anthropicResponse.json();
        const contentBlocks: Array<Record<string, unknown>> = result.content ?? [];

        const answer = contentBlocks
            .filter((block) => block.type === 'text')
            .map((block) => block.text as string)
            .join('\n')
            .trim();

        const toolUses = contentBlocks.filter((b) => b.type === 'mcp_tool_use');

        generation.end({
            model: MODEL,
            modelParameters: { max_tokens: MAX_TOKENS },
            input: anthropicMessages,
            output: answer || contentBlocks,
            usage: {
                input: result.usage?.input_tokens ?? 0,
                output: result.usage?.output_tokens ?? 0,
                cache_read: result.usage?.cache_read_input_tokens ?? 0,
            },
            promptName: systemPrompt.name,
            promptVersion: systemPrompt.version,
            metadata: {
                stop_reason: result.stop_reason ?? 'unknown',
                tool_call_count: toolUses.length,
            },
            level: result.stop_reason === 'refusal' ? 'WARNING' : 'DEFAULT',
        });

        // Anthropic ejecuta las tools en su lado, así que sólo podemos reconstruir
        // las llamadas a partir de los bloques de la respuesta: sabemos nombre,
        // argumentos y resultado, pero no cuánto tardó cada una. Por eso duración 0.
        for (const use of toolUses) {
            const resultBlock = contentBlocks.find(
                (b) => b.type === 'mcp_tool_result' && b.tool_use_id === use.id,
            );
            trace.addPointObservation(
                (use.name as string) ?? 'mcp_tool',
                'tool',
                {
                    input: use.input,
                    output: resultBlock?.content ?? null,
                    metadata: {
                        reconstructed: true,
                        tool_name: (use.name as string) ?? 'mcp_tool',
                        is_error: Boolean(resultBlock?.is_error),
                    },
                },
                generation.spanId,
            );
        }

        if (result.stop_reason === 'refusal') {
            trace.setTrace({ output: '[refusal]' });
            fireAndForget(trace.flush());
            return new Response(JSON.stringify({ error: 'La pregunta no pudo ser respondida' }), {
                status: 422,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        trace.setTrace({ output: answer });
        fireAndForget(trace.flush());

        return new Response(JSON.stringify({ answer }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('ask-territorios error:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
});

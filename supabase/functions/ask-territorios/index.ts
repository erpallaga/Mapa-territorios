import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Solo lectura: este modelo únicamente puede consultar el estado de los
// territorios a través de las tools del servidor MCP remoto (ver api/mcp.js).
const MODEL = 'claude-haiku-4-5';
const MCP_BETA_HEADER = 'mcp-client-2025-11-20';
const SYSTEM_PROMPT = 'Respondes preguntas sobre el estado de los territorios de predicación ' +
    '(libre/asignado, vencidos, zonas, historial) usando exclusivamente las tools disponibles. ' +
    'Responde siempre en español, de forma breve y concreta. No inventes datos que no obtengas de las tools.';

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

        const { question } = await req.json();
        if (!question || typeof question !== 'string' || question.trim() === '') {
            return new Response(JSON.stringify({ error: 'question is required' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
        if (question.length > 2000) {
            return new Response(JSON.stringify({ error: 'question is too long (max 2000 characters)' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')!;
        const mcpServerUrl = Deno.env.get('MCP_SERVER_URL')!;
        const mcpSharedSecret = Deno.env.get('MCP_SHARED_SECRET')!;

        // El conector MCP de la API de Anthropic llama él mismo a las tools
        // del servidor remoto (api/mcp.js) dentro de esta misma petición —
        // no hace falta un bucle manual de tool-use en esta función.
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
                max_tokens: 1024,
                system: SYSTEM_PROMPT,
                mcp_servers: [{
                    type: 'url',
                    name: 'territorios',
                    url: mcpServerUrl,
                    authorization_token: mcpSharedSecret,
                }],
                tools: [{ type: 'mcp_toolset', mcp_server_name: 'territorios' }],
                messages: [{ role: 'user', content: question.trim() }],
            }),
        });

        if (!anthropicResponse.ok) {
            const errText = await anthropicResponse.text();
            console.error('Anthropic API error:', anthropicResponse.status, errText);
            return new Response(JSON.stringify({ error: 'Failed to get an answer' }), {
                status: 502,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const result = await anthropicResponse.json();

        if (result.stop_reason === 'refusal') {
            return new Response(JSON.stringify({ error: 'La pregunta no pudo ser respondida' }), {
                status: 422,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        const answer = (result.content || [])
            .filter((block: { type: string }) => block.type === 'text')
            .map((block: { text: string }) => block.text)
            .join('\n')
            .trim();

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

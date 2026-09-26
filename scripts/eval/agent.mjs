// Réplica de la llamada que hace supabase/functions/ask-territorios/index.ts.
//
// OJO — DUPLICACIÓN CONOCIDA: MODEL, MAX_TOKENS y MAX_CONTINUACIONES están repetidos aquí y en
// supabase/functions/ask-territorios/index.ts. Si cambias uno, cambia el otro.
// El system prompt NO está duplicado: se lee de Langfuse, que es la fuente única.

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 1024;
const MCP_BETA_HEADER = 'mcp-client-2025-11-20';
const MAX_CONTINUACIONES = 3; // también duplicado en ask-territorios/index.ts
const PROMPT_NAME = 'ask-territorios-system';

let cachedPrompt = null;

async function getSystemPrompt() {
  if (cachedPrompt) return cachedPrompt;

  const auth = Buffer.from(
    `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`,
  ).toString('base64');

  const res = await fetch(
    `${process.env.LANGFUSE_BASE_URL}/api/public/v2/prompts/${PROMPT_NAME}?label=production`,
    { headers: { Authorization: `Basic ${auth}` } },
  );

  if (!res.ok) {
    throw new Error(
      `No se pudo leer el prompt de Langfuse (${res.status}). ` +
      'Ejecuta primero: node --env-file=.env scripts/langfuse-seed-prompt.mjs',
    );
  }

  const data = await res.json();
  cachedPrompt = data.prompt;
  return cachedPrompt;
}

export async function askTerritorios(question) {
  const system = await getSystemPrompt();

  // Igual que en producción: si el bucle de tools del conector MCP se pausa
  // (stop_reason 'pause_turn'), se reenvía el turno para que continúe.
  const messages = [{ role: 'user', content: question }];
  const blocks = [];
  let result;
  for (let continuaciones = 0; ; continuaciones++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': MCP_BETA_HEADER,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        mcp_servers: [{
          type: 'url',
          name: 'territorios',
          url: process.env.MCP_SERVER_URL,
          authorization_token: process.env.MCP_SHARED_SECRET,
        }],
        tools: [{ type: 'mcp_toolset', mcp_server_name: 'territorios' }],
        messages,
      }),
    });

    if (!res.ok) {
      throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    }

    result = await res.json();
    const turno = result.content ?? [];
    blocks.push(...turno);
    if (result.stop_reason !== 'pause_turn' || continuaciones >= MAX_CONTINUACIONES) break;
    messages.push({ role: 'assistant', content: turno });
  }

  return {
    answer: blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim(),
    toolCalls: blocks.filter((b) => b.type === 'mcp_tool_use').map((b) => b.name),
    stopReason: result.stop_reason ?? 'unknown',
  };
}

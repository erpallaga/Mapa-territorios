// Tres evaluadores: uno con LLM-as-judge y dos deterministas.
// El `output` que reciben es el objeto que devuelve askTerritorios():
// { answer, toolCalls, stopReason }.

const JUDGE_MODEL = 'claude-sonnet-5';

const JUDGE_SYSTEM =
  'Eres un evaluador estricto. Recibes una PREGUNTA, una RÚBRICA que describe qué debe ' +
  'cumplir una buena respuesta, y la RESPUESTA de un asistente. Puntúa de 0 a 1 según ' +
  'cuánto cumple la rúbrica. Penaliza duramente los datos inventados. ' +
  'Responde SOLO con un JSON: {"score": <0-1>, "reason": "<una frase>"}.';

// LLM-as-judge: compara la respuesta con la rúbrica de expectedOutput.
export async function accuracy({ input, output, expectedOutput }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 300,
      system: JUDGE_SYSTEM,
      messages: [{
        role: 'user',
        content: `PREGUNTA:\n${input}\n\nRÚBRICA:\n${expectedOutput}\n\nRESPUESTA:\n${output.answer}`,
      }],
    }),
  });

  if (!res.ok) {
    return { name: 'accuracy', value: null, comment: `judge error ${res.status}` };
  }

  const data = await res.json();
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');

  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match[0]);
    return { name: 'accuracy', value: Number(parsed.score), comment: parsed.reason };
  } catch {
    return { name: 'accuracy', value: null, comment: `unparseable judge output: ${text.slice(0, 200)}` };
  }
}

// Determinista: ¿usó tools cuando debía, y se abstuvo cuando no debía?
export async function usedTools({ output, metadata }) {
  const requiresTool = metadata?.requiresTool === true;
  const called = output.toolCalls.length > 0;
  const correct = requiresTool ? called : !called;
  return {
    name: 'used-tools',
    value: correct ? 1 : 0,
    comment: requiresTool
      ? `esperaba tool call, ${called ? 'la hubo' : 'NO la hubo'}`
      : `no esperaba tool call, ${called ? 'pero la hubo' : 'y no la hubo'}`,
  };
}

// Determinista y barato: comprueba que la respuesta está en español.
// Heurística: palabras funcionales frecuentes en español y ausencia de las inglesas.
const ES_MARKERS = /\b(el|la|los|las|de|que|está|están|hay|no|para|con|territorio|territorios|zona)\b/i;
const EN_MARKERS = /\b(the|is|are|there|and|of|for|territory|assigned|free)\b/i;

export async function spanish({ output }) {
  const text = output.answer ?? '';
  if (!text.trim()) {
    return { name: 'spanish', value: 0, comment: 'respuesta vacía' };
  }
  const es = ES_MARKERS.test(text);
  const en = EN_MARKERS.test(text);
  const value = es && !en ? 1 : 0;
  return {
    name: 'spanish',
    value,
    comment: value === 1 ? 'en español' : `marcadores es=${es} en=${en}`,
  };
}

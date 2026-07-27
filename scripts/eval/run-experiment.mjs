// Ejecuta el dataset ask-territorios-v1 contra el agente y sube el experimento
// a Langfuse con environment "evaluation", para no mezclarlo con producción.
//
// Usage (desde scripts/eval): npm run eval

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { LangfuseClient } from '@langfuse/client';
import { askTerritorios } from './agent.mjs';
import { accuracy, usedTools, spanish } from './evaluators.mjs';

process.env.LANGFUSE_TRACING_ENVIRONMENT = 'evaluation';

const otelSdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
otelSdk.start();

const langfuse = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL,
});

const dataset = await langfuse.dataset.get('ask-territorios-v1');

const result = await dataset.runExperiment({
  name: 'ask-territorios',
  runName: `local-${new Date().toISOString().slice(0, 16)}`,
  description: 'Evaluación offline del agente de territorios contra la rúbrica del dataset.',
  task: async (item) => askTerritorios(item.input),
  evaluators: [accuracy, usedTools, spanish],
  // Secuencial a propósito: las tools pegan a una hoja de Google compartida
  // y la API de Anthropic tiene rate limits. 20 items tardan ~2 minutos.
  maxConcurrency: 2,
});

console.log(await result.format());

await otelSdk.shutdown();

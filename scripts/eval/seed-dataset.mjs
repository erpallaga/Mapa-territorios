// Sube dataset.json al dataset "ask-territorios-v1" de Langfuse.
// Idempotente: los items usan un id estable derivado de la pregunta, así que
// volver a ejecutarlo actualiza en vez de duplicar.
//
// Usage (desde scripts/eval): npm run seed

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const BASE_URL = process.env.LANGFUSE_BASE_URL;
const DATASET_NAME = 'ask-territorios-v1';

const auth = Buffer.from(
  `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`,
).toString('base64');

const headers = {
  'Content-Type': 'application/json',
  Authorization: `Basic ${auth}`,
};

const createRes = await fetch(`${BASE_URL}/api/public/v2/datasets`, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    name: DATASET_NAME,
    description: 'Preguntas en español sobre el estado de los territorios. expectedOutput es una rúbrica, no una respuesta literal.',
  }),
});

if (!createRes.ok && createRes.status !== 409) {
  console.error('dataset create failed:', createRes.status, await createRes.text());
  process.exit(1);
}

const items = JSON.parse(await readFile(new URL('./dataset.json', import.meta.url), 'utf8'));

for (const item of items) {
  const id = createHash('sha1').update(item.input).digest('hex').slice(0, 16);
  const res = await fetch(`${BASE_URL}/api/public/dataset-items`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id,
      datasetName: DATASET_NAME,
      input: item.input,
      expectedOutput: item.expectedOutput,
      metadata: item.metadata,
    }),
  });
  if (!res.ok) {
    console.error('item failed:', item.input, res.status, await res.text());
    process.exit(1);
  }
  console.log('ok:', item.input);
}

console.log(`\nSeeded ${items.length} items into "${DATASET_NAME}".`);

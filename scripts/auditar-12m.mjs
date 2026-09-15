// Audita la vista de "12 meses" contra los datos reales del Sheet.
//
// Responde a la pregunta que el panel no sabe contestar por sí solo: "dice que
// este territorio se ha trabajado en los últimos 12 meses, ¿de dónde se lo
// saca?". Para cada territorio imprime la fecha que gana, de qué celda sale y
// en qué categoría cae, y al final lista los casos en los que la columna
// "última fecha en que se completó" y el historial no cuentan lo mismo, que son
// los que hay que mirar en la hoja.
//
// Uso:
//   node scripts/auditar-12m.mjs                  # la Sheet publicada por defecto
//   node scripts/auditar-12m.mjs <url-o-fichero>  # otro CSV
//   node scripts/auditar-12m.mjs --detalle        # además, una línea por territorio
//
// También respeta TERRITORIOS_SHEET_URL, igual que el servidor MCP.

import fs from 'node:fs';

import { fetchTerritoryData, parseTerritoryCsv } from '../src/lib/sheets.js';
import { formatSheetDate } from '../src/lib/dates.js';
import {
  CATEGORIA_0_6,
  CATEGORIA_6_12,
  CATEGORIA_MAS_12,
  CATEGORIA_SIN_FECHA,
  categoria12m,
  finalizacionesUltimos12Meses,
  ultimaFinalizacionDetallada,
} from '../src/lib/completion.js';

const SHEET_URL_POR_DEFECTO =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQugwzM2d854XUSxfQBG-UXngD8bhKp-Tt72E_BEgeS80PtoQXNQg0YTFOt70iNE3s3sr2b6NSOfZoo/pub?output=csv';

const args = process.argv.slice(2);
const detalle = args.includes('--detalle');
const origen =
  args.find((a) => !a.startsWith('--')) || process.env.TERRITORIOS_SHEET_URL || SHEET_URL_POR_DEFECTO;

const hoy = new Date();

const territorios = (
  /^https?:\/\//.test(origen)
    ? await fetchTerritoryData(origen)
    : await parseTerritoryCsv(fs.readFileSync(origen, 'utf8'))
).filter((t) => t.id && String(t.id).trim());

if (territorios.length === 0) {
  console.error(`No se ha leído ningún territorio de ${origen}`);
  process.exit(1);
}

const ETIQUETAS = {
  [CATEGORIA_0_6]: 'trabajado hace 0-6 meses',
  [CATEGORIA_6_12]: 'trabajado hace 6-12 meses',
  [CATEGORIA_MAS_12]: 'sin trabajar hace más de 12 meses',
  [CATEGORIA_SIN_FECHA]: 'sin fecha de finalización legible',
};

const recuento = { [CATEGORIA_0_6]: 0, [CATEGORIA_6_12]: 0, [CATEGORIA_MAS_12]: 0, [CATEGORIA_SIN_FECHA]: 0 };
const soloColumna = []; // la columna va por delante del historial
const soloHistorial = []; // el historial va por delante de la columna
const trabajadoSinEventos = []; // cuenta como trabajado, pero el historial no tiene ninguna finalización en 12m
const fechasFuturas = [];
const filas = [];

for (const t of territorios) {
  const info = ultimaFinalizacionDetallada(t, hoy);
  const cat = categoria12m(t, hoy);
  const eventos = finalizacionesUltimos12Meses(t, hoy);
  recuento[cat]++;

  if (info.futuras > 0) fechasFuturas.push({ t, n: info.futuras });
  if (info.fuente === 'columna') soloColumna.push({ t, info });
  if (info.fuente === 'historial') soloHistorial.push({ t, info });
  if ((cat === CATEGORIA_0_6 || cat === CATEGORIA_6_12) && eventos === 0) {
    trabajadoSinEventos.push({ t, info });
  }

  filas.push({ t, info, cat, eventos });
}

const total = territorios.length;
const trabajados = recuento[CATEGORIA_0_6] + recuento[CATEGORIA_6_12];
const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);

console.log(`Origen: ${origen}`);
console.log(`Hoy: ${formatSheetDate(hoy)}`);
console.log(`Territorios: ${total}`);
console.log('');
console.log(`Trabajados en 12 meses: ${trabajados} (${pct(trabajados)}%)`);
console.log(`  0-6 meses:            ${recuento[CATEGORIA_0_6]}`);
console.log(`  6-12 meses:           ${recuento[CATEGORIA_6_12]}`);
console.log(`Sin trabajar (>12m):    ${recuento[CATEGORIA_MAS_12]} (${pct(recuento[CATEGORIA_MAS_12])}%)`);
console.log(`Sin fecha legible:      ${recuento[CATEGORIA_SIN_FECHA]} (${pct(recuento[CATEGORIA_SIN_FECHA])}%)`);

if (trabajadoSinEventos.length > 0) {
  console.log('\n--- Cuentan como trabajados solo por la columna, sin finalización en el historial ---');
  console.log('    (es el caso que hace que el panel parezca demasiado optimista: revisa estas filas)');
  for (const { t, info } of trabajadoSinEventos) {
    console.log(
      `  Territorio ${t.id} (${t.zone || 'sin zona'}): columna "${String(t.lastCompletedDate ?? '').trim()}" ` +
        `-> ${formatSheetDate(info.date)}, pero ninguna celda "completado" del historial cae en los últimos 12 meses`
    );
  }
}

if (soloColumna.length > 0) {
  console.log('\n--- La columna va por delante del historial ---');
  for (const { t, info } of soloColumna) {
    console.log(`  Territorio ${t.id}: se usa ${formatSheetDate(info.date)} (columna)`);
  }
}

if (soloHistorial.length > 0) {
  console.log('\n--- El historial va por delante de la columna ---');
  console.log('    (la columna "última fecha en que se completó" se ha quedado sin actualizar)');
  for (const { t, info } of soloHistorial) {
    console.log(
      `  Territorio ${t.id}: se usa ${formatSheetDate(info.date)} (historial); ` +
        `la columna dice "${String(t.lastCompletedDate ?? '').trim() || '(vacía)'}"`
    );
  }
}

if (fechasFuturas.length > 0) {
  console.log('\n--- Fechas de finalización posteriores a hoy (descartadas por errata) ---');
  for (const { t, n } of fechasFuturas) {
    console.log(`  Territorio ${t.id}: ${n} ${n === 1 ? 'fecha' : 'fechas'} en el futuro`);
  }
}

if (recuento[CATEGORIA_SIN_FECHA] > 0) {
  console.log('\n--- Sin ninguna fecha de finalización legible ---');
  for (const { t, cat } of filas) {
    if (cat !== CATEGORIA_SIN_FECHA) continue;
    console.log(
      `  Territorio ${t.id} (${t.zone || 'sin zona'}): estado ${t.status === 'free' ? 'libre' : 'asignado'}, ` +
        `columna "${String(t.lastCompletedDate ?? '').trim() || '(vacía)'}", ${t.history.length} entradas de historial`
    );
  }
  console.log('  Para saber si es que la fecha está mal escrita, pasa antes `npm run auditar-fechas`.');
}

if (detalle) {
  console.log('\n--- Detalle por territorio ---');
  for (const { t, info, cat, eventos } of filas) {
    console.log(
      `  ${String(t.id).padStart(3)} | ${(t.zone || 'sin zona').padEnd(14)} | ` +
        `${(info.date ? formatSheetDate(info.date) : '—').padEnd(10)} | ` +
        `${(info.fuente || '—').padEnd(9)} | ${String(eventos).padStart(2)} ${eventos === 1 ? 'finalización ' : 'finalizaciones'} 12m | ${ETIQUETAS[cat]}`
    );
  }
}

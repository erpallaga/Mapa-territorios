// Audita todas las fechas del Sheet contra el parser de src/lib/dates.js.
//
// Sirve para responder a "¿el parser entiende de verdad lo que hay escrito en mi
// hoja?" sin tener que abrirla a mano: recorre todas las celdas de fecha, cuenta
// cuántas se interpretan bien y lista las que no, con el territorio en el que
// están, para poder ir a arreglarlas.
//
// Uso:
//   node scripts/auditar-fechas.mjs                 # la Sheet publicada por defecto
//   node scripts/auditar-fechas.mjs <url-o-fichero> # otro CSV
//
// También respeta TERRITORIOS_SHEET_URL, igual que el servidor MCP.

import fs from 'node:fs';
import Papa from 'papaparse';
import { parseSheetDateDetailed, formatISODate } from '../src/lib/dates.js';

const SHEET_URL_POR_DEFECTO =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQugwzM2d854XUSxfQBG-UXngD8bhKp-Tt72E_BEgeS80PtoQXNQg0YTFOt70iNE3s3sr2b6NSOfZoo/pub?output=csv';

const origen = process.argv[2] || process.env.TERRITORIOS_SHEET_URL || SHEET_URL_POR_DEFECTO;

async function leerCsv(origen) {
  if (/^https?:\/\//.test(origen)) {
    const res = await fetch(origen);
    if (!res.ok) throw new Error(`No se pudo descargar el CSV (${res.status})`);
    return res.text();
  }
  return fs.readFileSync(origen, 'utf8');
}

const csv = await leerCsv(origen);
const { data: filas } = Papa.parse(csv, { header: false, skipEmptyLines: true });

const celdas = [];
for (const fila of filas.slice(1)) {
  const id = fila[0];
  if (!id) continue;

  celdas.push({ id, columna: 'última fecha completada', valor: fila[4] });
  // Grupos de 3 desde el índice 5: [publicador, asignado, completado].
  for (let i = 5; i < fila.length; i += 3) {
    if (!fila[i] || !String(fila[i]).trim()) continue;
    celdas.push({ id, columna: 'asignado', valor: fila[i + 1] });
    celdas.push({ id, columna: 'completado', valor: fila[i + 2] });
  }
}

const vacias = [];
const correctas = [];
const ambiguas = [];
const noReconocidas = [];

for (const celda of celdas) {
  const r = parseSheetDateDetailed(celda.valor);
  if (r.motivo === 'vacia') vacias.push(celda);
  else if (!r.date) noReconocidas.push(celda);
  else if (r.ambigua) ambiguas.push({ ...celda, interpretada: formatISODate(r.date) });
  else correctas.push(celda);
}

console.log(`Origen: ${origen}`);
console.log(`Territorios: ${new Set(celdas.map((c) => c.id)).size}`);
console.log(`Celdas de fecha: ${celdas.length}`);
console.log(`  Interpretadas: ${correctas.length}`);
console.log(`  Vacías:        ${vacias.length}`);
console.log(`  Ambiguas:      ${ambiguas.length}`);
console.log(`  NO entendidas: ${noReconocidas.length}`);

if (ambiguas.length > 0) {
  console.log('\n--- Ambiguas (parecían tener el día y el mes invertidos) ---');
  for (const a of ambiguas) {
    console.log(`  Territorio ${a.id} · ${a.columna}: "${String(a.valor).trim()}" -> ${a.interpretada}`);
  }
}

if (noReconocidas.length > 0) {
  console.log('\n--- NO entendidas (quedan fuera de todos los recuentos) ---');
  const porValor = new Map();
  for (const n of noReconocidas) {
    const clave = String(n.valor).trim();
    if (!porValor.has(clave)) porValor.set(clave, []);
    porValor.get(clave).push(`${n.id}/${n.columna}`);
  }
  for (const [valor, donde] of [...porValor.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  "${valor}" (${donde.length}): ${donde.slice(0, 8).join(', ')}${donde.length > 8 ? '…' : ''}`);
  }
  console.log('\nSi alguno de estos formatos debería entenderse, añádelo como caso en');
  console.log('src/lib/dates.test.js y amplía parseSheetDateDetailed.');
} else {
  console.log('\nTodas las fechas escritas se interpretan correctamente.');
}

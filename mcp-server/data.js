import { SHEET_CSV_URL, loadTerritoryData } from "../src/lib/sheets.js";

// La URL por defecto es el Sheet publicado en producción. Se puede sobreescribir
// con TERRITORIOS_SHEET_URL para probar el servidor contra un CSV de ejemplo sin
// tocar el de verdad (los tests de humo lo usan).
const SHEET_URL = process.env.TERRITORIOS_SHEET_URL || SHEET_CSV_URL;

const CACHE_TTL_MS = 60_000;
let cache = { data: null, timestamp: 0 };
// Varias tools llamadas en paralelo con la caché caducada compartían una sola
// descarga en vez de lanzar una cada una.
let enCurso = null;

/**
 * Territorios de la hoja, con 60 s de caché.
 *
 * Si la descarga falla no se cachea nada: antes un fallo se guardaba como `[]`
 * durante un minuto y todas las tools contestaban "0 territorios" como si fuera
 * un dato. Ahora se sirve la última copia buena si la hay y, si no, se lanza
 * el error, que el SDK devuelve a la tool como `isError`.
 */
export async function getTerritories() {
  const now = Date.now();
  if (cache.data && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }
  if (enCurso) return enCurso;

  enCurso = (async () => {
    try {
      const data = await loadTerritoryData(SHEET_URL);
      cache = { data, timestamp: Date.now() };
      return data;
    } catch (error) {
      if (cache.data) {
        console.error("No se pudo refrescar la hoja; se sirve la última copia buena:", error);
        return cache.data;
      }
      throw error;
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}

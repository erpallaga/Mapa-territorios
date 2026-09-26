import Papa from 'papaparse';
import { daysBetween, parseSheetDate } from './dates.js';
import { finalizacionesUltimos12Meses, ultimaFinalizacion } from './completion.js';

/**
 * Una asignación "vence" a los 4 meses de entregarse. 122 días: es la cifra
 * exacta que pintan el mapa y el panel, así que cualquiera que necesite decir
 * *cuándo* vence un territorio tiene que salir de aquí y no de "cuatro meses"
 * contados a ojo, que se desvía un día según el mes.
 */
export const DIAS_VENCIMIENTO = Math.round(4 * 30.44); // 122

/**
 * La hoja de producción publicada como CSV. Vive aquí para que la web, el MCP
 * y los scripts de auditoría lean exactamente la misma URL.
 */
export const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQugwzM2d854XUSxfQBG-UXngD8bhKp-Tt72E_BEgeS80PtoQXNQg0YTFOt70iNE3s3sr2b6NSOfZoo/pub?output=csv';

/**
 * Descarga y parsea la hoja. Lanza si la descarga falla.
 *
 * Es la versión que hay que usar cuando un fallo tiene que verse: si Google
 * devuelve un 404 o una página de error, parsear eso como CSV daba "0
 * territorios" (o territorios basura) sin que nadie se enterara, y el MCP
 * contestaba con total seguridad que no había nada vencido.
 *
 * @param {string} sheetUrl - The URL of the published CSV.
 * @returns {Promise<Array>} - Array of territory objects.
 */
export async function loadTerritoryData(sheetUrl) {
    if (!sheetUrl) throw new Error('Falta la URL de la hoja de territorios.');

    // El CSV publicado de Google se sirve con caché (y el navegador puede
    // reutilizarlo encima). Sin romperla, un cambio hecho en la hoja puede
    // tardar en aparecer y el panel parece "no actualizarse".
    const response = await fetch(withCacheBuster(sheetUrl), { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`No se pudo descargar la hoja de territorios (HTTP ${response.status}).`);
    }
    const csvText = await response.text();
    // Cuando la hoja deja de estar publicada, Google contesta 200 con una
    // página HTML de login en vez del CSV.
    if (/^\s*<(!doctype|html)/i.test(csvText)) {
        throw new Error('La hoja de territorios no devolvió un CSV (¿ha dejado de estar publicada?).');
    }
    return parseTerritoryCsv(csvText);
}

/**
 * Como `loadTerritoryData`, pero devuelve `[]` si algo falla. Se conserva por
 * compatibilidad; el código nuevo debería usar `loadTerritoryData` y enseñar
 * el error.
 */
export async function fetchTerritoryData(sheetUrl) {
    try {
        return await loadTerritoryData(sheetUrl);
    } catch (error) {
        console.error("Error fetching sheet data:", error);
        return [];
    }
}

/**
 * Convierte el CSV de la hoja en registros de territorio.
 *
 * Está separado de la descarga para que los scripts de auditoría puedan pasarle
 * un fichero local sin tener que reimplementar el mapeo de columnas.
 *
 * @param {string} csvText
 * @returns {Promise<Array>}
 */
export function parseTerritoryCsv(csvText) {
    return new Promise((resolve, reject) => {
        Papa.parse(csvText, {
            header: false, // Changed to false to handle duplicate headers
            skipEmptyLines: true,
            complete: (results) => {
                const rows = results.data;
                // Skip header row
                const dataRows = rows.slice(1)
                    // La hoja acaba con una fila de totales ("TOTAL 42911" en la
                    // columna de viviendas) y sin número de territorio. Sin este
                    // filtro se cuela como un territorio más: al no poner "LIBRE"
                    // en su celda de estado se daba por asignada, y el recuento
                    // salía 181 en vez de 180 — que es lo que el agente venía
                    // contestando a "¿cuántos territorios hay?".
                    .filter(row => String(row?.[0] ?? '').trim() !== '');

                const mappedData = dataRows.map(row => {
                    // Basic info
                    // Column indices based on fixed structure:
                    // 0: Núm. de terr.
                    // 1: Zona
                    // 2: Número de viviendas (New)
                    // 3: Estado
                    // 4: Última fecha en que se completó*
                    // Recortados: un espacio de más en la celda del número
                    // hacía que el territorio no casara con su KML.
                    const id = String(row[0] ?? '').trim();
                    const zone = String(row[1] ?? '').trim();
                    const numViviendas = String(row[2] ?? '').trim();
                    const statusValue = (row[3] || '').trim().toUpperCase();
                    const status = statusValue === 'LIBRE' ? 'free' : 'assigned';
                    const lastCompletedDate = row[4];

                    // Find latest assignment and build the history.
                    // Groups start at index 5. Each group is 3 columns:
                    // [Assignee, Date Assigned, Date Completed]
                    let publisher = '';
                    let assignedDate = '';
                    const history = [];

                    // Iterate through groups of 3 columns
                    for (let i = 5; i < row.length; i += 3) {
                        const p = row[i];
                        const d = row[i + 1];
                        const c = row[i + 2]; // Completion Date

                        // If there is a publisher name, update our latest info
                        if (p && p.trim() !== '') {
                            publisher = p.trim();
                            assignedDate = (d || '').trim();

                            history.push({
                                publisher: p.trim(),
                                assignedDate: (d || '').trim(),
                                completedDate: (c || '').trim()
                            });
                        }
                    }

                    // Reverse history so latest assignments show up at the top
                    history.reverse();

                    // Los recuentos de 12 meses viven en `completion.js`: es la
                    // misma definición que usan el mapa, el panel y el MCP, y
                    // descarta las fechas posteriores a hoy (erratas de año) en
                    // vez de contarlas como finalizaciones recientes.
                    const completionCount12m = finalizacionesUltimos12Meses({ history });
                    const lastCompletionDate = ultimaFinalizacion({ lastCompletedDate, history });

                    // Calculate expired status (>= 4 months assigned)
                    let isExpired = false;
                    let expiredDays = 0;
                    if (status === 'assigned' && assignedDate) {
                        const assignedDateObj = parseSheetDate(assignedDate);
                        if (assignedDateObj) {
                            // Días de calendario, igual que `caducidad()` en el
                            // MCP: con una resta de milisegundos, el cambio de
                            // hora de marzo le quitaba un día al recuento y el
                            // panel y el agente discrepaban en "vence hoy".
                            const diffDaysTotal = daysBetween(assignedDateObj, new Date());
                            if (diffDaysTotal >= DIAS_VENCIMIENTO) {
                                isExpired = true;
                                expiredDays = diffDaysTotal - DIAS_VENCIMIENTO; // Days PAST the 4-month mark
                            }
                        }
                    }

                    return {
                        id,
                        zone,
                        numViviendas,
                        status,
                        publisher,
                        assignedDate,
                        lastCompletedDate,
                        lastCompletionDate,
                        completionCount12m,
                        history,
                        isExpired,
                        expiredDays
                    };
                });
                resolve(mappedData);
            },
            error: (error) => {
                reject(error);
            }
        });
    });
}

/**
 * Añade un parámetro que cambia cada minuto. Suficiente para no quedarse con un
 * CSV viejo y para no machacar a Google con una URL distinta por render.
 */
function withCacheBuster(url) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}_=${Math.floor(Date.now() / 60000)}`;
}

import Papa from 'papaparse';
import { parseSheetDate } from './dates.js';
import { finalizacionesUltimos12Meses, ultimaFinalizacion } from './completion.js';

/**
 * Fetches territory data from a Google Sheet published as CSV.
 * @param {string} sheetUrl - The URL of the published CSV.
 * @returns {Promise<Array>} - Array of territory objects.
 */
export async function fetchTerritoryData(sheetUrl) {
    if (!sheetUrl) return [];

    try {
        // El CSV publicado de Google se sirve con caché (y el navegador puede
        // reutilizarlo encima). Sin romperla, un cambio hecho en la hoja puede
        // tardar en aparecer y el panel parece "no actualizarse".
        const response = await fetch(withCacheBuster(sheetUrl), { cache: 'no-store' });
        const csvText = await response.text();
        return await parseTerritoryCsv(csvText);
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
                const dataRows = rows.slice(1);

                const mappedData = dataRows.map(row => {
                    // Basic info
                    // Column indices based on fixed structure:
                    // 0: Núm. de terr.
                    // 1: Zona
                    // 2: Número de viviendas (New)
                    // 3: Estado
                    // 4: Última fecha en que se completó*
                    const id = row[0];
                    const zone = row[1];
                    const numViviendas = row[2];
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
                            publisher = p;
                            assignedDate = d;

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
                    if (status === 'assigned' && assignedDate && assignedDate.trim() !== '') {
                        const assignedDateObj = parseSheetDate(assignedDate);
                        if (assignedDateObj) {
                            const now = new Date();
                            const diffMs = now - assignedDateObj;
                            const diffDaysTotal = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                            const fourMonthsInDays = Math.round(4 * 30.44); // ~122 days
                            if (diffDaysTotal >= fourMonthsInDays) {
                                isExpired = true;
                                expiredDays = diffDaysTotal - fourMonthsInDays; // Days PAST the 4-month mark
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

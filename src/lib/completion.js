/**
 * "¿Cuándo se trabajó por última vez este territorio?" — una sola respuesta.
 *
 * Esta pregunta se contestaba en tres sitios distintos y de tres maneras
 * distintas:
 *
 *   - `Dashboard.jsx` miraba solo la columna "última fecha en que se completó".
 *   - El gráfico de frecuencia del mismo panel miraba solo el historial
 *     (`completionCount12m`), así que podía decir "0 veces" en un territorio que
 *     las tarjetas de arriba contaban como trabajado.
 *   - `Map.jsx` calculaba los meses con `Math.abs`, de modo que una fecha
 *     futura (una errata de año, que en una hoja escrita a mano las hay) salía
 *     pintada como "recién trabajado" en vez de como sospechosa.
 *   - El MCP (`ultimaFinalizacion`) sí cruzaba columna e historial.
 *
 * Aquí vive la versión buena y de ella tiran los cuatro. Dos reglas que son el
 * fondo del asunto:
 *
 *  1. La última finalización es el MÁXIMO entre la columna y el historial. En
 *     una hoja a mano cualquiera de las dos puede ir por delante de la otra.
 *  2. Una fecha posterior a hoy no es una finalización, es una errata. Se
 *     descarta del recuento y se cuenta aparte para poder enseñarla, en vez de
 *     dejar que ascienda al territorio a "trabajado hace 0-6 meses".
 */

import { addMonths, daysBetween, parseSheetDate, startOfDay } from './dates.js';

/** Categorías de la vista "12 meses", en el orden en que se presentan. */
export const CATEGORIA_0_6 = '0-6';
export const CATEGORIA_6_12 = '6-12';
export const CATEGORIA_MAS_12 = 'mas-12';
export const CATEGORIA_SIN_FECHA = 'sin-fecha';

/**
 * Última finalización de un territorio, cruzando la columna y el historial.
 *
 * @param {object} territorio - registro de `fetchTerritoryData` (o las
 *   `properties` de un feature ya mergeado).
 * @param {Date} [hoy]
 * @returns {{date: Date|null, fuente: 'columna'|'historial'|'ambas'|null, futuras: number}}
 *   `fuente` dice de dónde sale la fecha ganadora — sirve para detectar que la
 *   columna y el historial no cuentan lo mismo. `futuras` es cuántas fechas de
 *   finalización caen después de hoy (erratas descartadas).
 */
export function ultimaFinalizacionDetallada(territorio, hoy = new Date()) {
    const limite = startOfDay(hoy);
    let futuras = 0;

    const aceptar = (raw) => {
        const d = parseSheetDate(raw);
        if (!d) return null;
        if (startOfDay(d) > limite) {
            futuras++;
            return null;
        }
        return d;
    };

    const deColumna = aceptar(territorio?.lastCompletedDate);

    let deHistorial = null;
    for (const h of territorio?.history || []) {
        const d = aceptar(h?.completedDate);
        if (d && (!deHistorial || d > deHistorial)) deHistorial = d;
    }

    if (!deColumna && !deHistorial) return { date: null, fuente: null, futuras };
    if (deColumna && !deHistorial) return { date: deColumna, fuente: 'columna', futuras };
    if (!deColumna && deHistorial) return { date: deHistorial, fuente: 'historial', futuras };

    if (deColumna.getTime() === deHistorial.getTime()) {
        return { date: deColumna, fuente: 'ambas', futuras };
    }
    return deColumna > deHistorial
        ? { date: deColumna, fuente: 'columna', futuras }
        : { date: deHistorial, fuente: 'historial', futuras };
}

/** Versión corta: la fecha o `null`. */
export function ultimaFinalizacion(territorio, hoy = new Date()) {
    return ultimaFinalizacionDetallada(territorio, hoy).date;
}

/**
 * Meses transcurridos desde la última finalización.
 * `Infinity` si no consta ninguna, para que ordenar por antigüedad las ponga
 * al final sin casos especiales. Nunca negativo: las fechas futuras ya se han
 * descartado antes de llegar aquí.
 */
export function mesesDesdeFinalizacion(territorio, hoy = new Date()) {
    const date = ultimaFinalizacion(territorio, hoy);
    if (!date) return Infinity;
    return daysBetween(date, hoy) / 30.44;
}

/**
 * Categoría de la vista "12 meses".
 *
 * Los cortes se calculan en fechas completas (`addMonths` sobre el día de hoy),
 * no en "días / 30.44": así el límite de los 6 y los 12 meses cae en el mismo
 * sitio en el mapa y en el panel, y no se mueve según la hora a la que se mire.
 */
export function categoria12m(territorio, hoy = new Date()) {
    const date = ultimaFinalizacion(territorio, hoy);
    if (!date) return CATEGORIA_SIN_FECHA;

    const hoy0 = startOfDay(hoy);
    const dia = startOfDay(date);
    if (dia >= addMonths(hoy0, -6)) return CATEGORIA_0_6;
    if (dia >= addMonths(hoy0, -12)) return CATEGORIA_6_12;
    return CATEGORIA_MAS_12;
}

/** `true` si consta trabajado en los últimos 12 meses. */
export function trabajadoUltimos12Meses(territorio, hoy = new Date()) {
    const cat = categoria12m(territorio, hoy);
    return cat === CATEGORIA_0_6 || cat === CATEGORIA_6_12;
}

/**
 * Cuántas veces se completó el territorio en los últimos 12 meses, contando
 * solo eventos del historial y descartando los futuros. Es la cifra que sale
 * en el badge del mapa y en el gráfico de frecuencia; si dice 0 en un
 * territorio que la categoría da por trabajado, la discrepancia está en la
 * hoja (columna al día, historial sin rellenar) y `auditar-12m` la lista.
 */
export function finalizacionesUltimos12Meses(territorio, hoy = new Date()) {
    const hoy0 = startOfDay(hoy);
    const desde = addMonths(hoy0, -12);
    let n = 0;
    for (const h of territorio?.history || []) {
        const d = parseSheetDate(h?.completedDate);
        if (!d) continue;
        const dia = startOfDay(d);
        if (dia >= desde && dia <= hoy0) n++;
    }
    return n;
}

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

import {
    MES_INICIO_ANYO_SERVICIO,
    addMonths,
    anyoServicioDe,
    daysBetween,
    parseSheetDate,
    rangoAnyoServicio,
    startOfDay,
} from './dates.js';

// Los límites del año de servicio son aritmética de calendario y viven en
// `dates.js`, que es quien los necesita para resolver el periodo
// 'anyo_servicio'. Se reexportan aquí porque este módulo sigue siendo el sitio
// donde se explica qué es el año de servicio y en qué se diferencia de la
// ventana móvil de 12 meses.
export { MES_INICIO_ANYO_SERVICIO, anyoServicioDe, rangoAnyoServicio } from './dates.js';

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

// ─── Año de servicio ────────────────────────────────────────────────────────
//
// El año de servicio va del 1 de septiembre al 31 de agosto. A diferencia de la
// ventana móvil de 12 meses ("¿algún territorio lleva demasiado sin tocarse?"),
// es un periodo cerrado con fecha de corte: "¿cerramos el año con todo
// cubierto?". Por eso las dos vistas conviven en vez de sustituirse.

export const COBERTURA_CUBIERTO = 'cubierto';
export const COBERTURA_EN_CURSO = 'en-curso';
export const COBERTURA_SIN_CUBRIR = 'sin-cubrir';

/**
 * Fechas en que consta completado un territorio, de la más antigua a la más
 * reciente, sin repeticiones y sin las posteriores a hoy.
 *
 * Une la columna "última fecha en que se completó" con el historial porque
 * cualquiera de las dos puede ir por delante, y deduplica por día: lo normal es
 * que la columna repita la última fila del historial, y contarla dos veces
 * inflaría la cobertura.
 *
 * Ojo: no es lo mismo que `finalizacionesUltimos12Meses`, que cuenta solo
 * eventos del historial a propósito, para que `auditar-12m` pueda detectar los
 * territorios que constan trabajados únicamente por la columna.
 */
export function fechasFinalizacion(territorio, hoy = new Date()) {
    const limite = startOfDay(hoy);
    const vistas = new Set();
    const fechas = [];

    const anotar = (raw) => {
        const d = parseSheetDate(raw);
        if (!d) return;
        const dia = startOfDay(d);
        if (dia > limite) return; // fecha futura: errata de año, no una finalización
        const clave = dia.getTime();
        if (vistas.has(clave)) return;
        vistas.add(clave);
        fechas.push(dia);
    };

    anotar(territorio?.lastCompletedDate);
    for (const h of territorio?.history || []) anotar(h?.completedDate);

    fechas.sort((a, b) => a - b);
    return fechas;
}

/**
 * Veces que se completó el territorio dentro de un año de servicio.
 * @param {number} [anyo] - por defecto, el año de servicio en curso.
 * @param {Date} [hasta] - corta el recuento en esta fecha (para comparar "a la
 *   misma altura" del año pasado). Por defecto, hoy.
 */
export function pasesEnAnyoServicio(territorio, anyo, hoy = new Date(), hasta = null) {
    const { inicio, fin } = rangoAnyoServicio(anyo ?? anyoServicioDe(hoy));
    const tope = hasta ? startOfDay(hasta) : fin;
    return fechasFinalizacion(territorio, hoy).filter((d) => d >= inicio && d <= fin && d <= tope).length;
}

/**
 * Estado de cobertura de un territorio en el año de servicio.
 *
 * - `cubierto`: se completó al menos una vez dentro del año.
 * - `en-curso`: todavía no, pero alguien lo tiene asignado ahora mismo.
 * - `sin-cubrir`: ni lo uno ni lo otro. Es la lista de trabajo pendiente.
 */
export function coberturaAnyoServicio(territorio, anyo, hoy = new Date(), hasta = null) {
    if (pasesEnAnyoServicio(territorio, anyo, hoy, hasta) > 0) return COBERTURA_CUBIERTO;
    return territorio?.status === 'assigned' ? COBERTURA_EN_CURSO : COBERTURA_SIN_CUBRIR;
}

export const MESES_ANYO_SERVICIO = ['Sep', 'Oct', 'Nov', 'Dic', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago'];

/**
 * Cobertura acumulada mes a mes, de septiembre a agosto, para el gráfico de
 * progreso. Cada punto es "cuántos territorios distintos llevábamos cubiertos al
 * acabar ese mes" (o a día de hoy, si el mes está en curso). Los meses que aún
 * no han empezado valen `null`, no cero: la línea del año en curso se corta en
 * el mes actual en vez de desplomarse y fingir que no se ha trabajado nada.
 */
export function progresoAnyoServicio(territorios, anyo, hoy = new Date()) {
    const { inicio, fin } = rangoAnyoServicio(anyo);
    const cubiertosPorMes = new Array(12).fill(0);

    for (const t of territorios) {
        // Solo cuenta el primer pase: esto es "territorios cubiertos", no "pases".
        const primera = fechasFinalizacion(t, hoy).find((d) => d >= inicio && d <= fin);
        if (!primera) continue;
        const indice = (primera.getMonth() - MES_INICIO_ANYO_SERVICIO + 12) % 12;
        cubiertosPorMes[indice]++;
    }

    const hoy0 = startOfDay(hoy);
    let acumulado = 0;
    return cubiertosPorMes.map((n, i) => {
        acumulado += n;
        const inicioMes = addMonths(inicio, i);
        return { mes: MESES_ANYO_SERVICIO[i], valor: inicioMes > hoy0 ? null : acumulado };
    });
}

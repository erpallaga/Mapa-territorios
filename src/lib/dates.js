/**
 * Parseo y normalización de fechas.
 *
 * El Google Sheet se rellena a mano, así que la misma columna puede traer
 * "3/6/2026", "03-06-26", "3 de junio de 2026" o incluso un número de serie de
 * hoja de cálculo. Este módulo centraliza la interpretación para que la web app
 * (`sheets.js`) y el servidor MCP entiendan exactamente lo mismo, y para que las
 * fechas que no se puedan interpretar se puedan contar y reportar en vez de
 * desaparecer en silencio.
 *
 * Convención: día primero (formato español). Todas las fechas se construyen a
 * medianoche en hora local; no hay componente horario en el origen.
 */

const MONTH_NAMES = {
    enero: 1, ene: 1,
    febrero: 2, feb: 2,
    marzo: 3, mar: 3,
    abril: 4, abr: 4,
    mayo: 5, may: 5,
    junio: 6, jun: 6,
    julio: 7, jul: 7,
    agosto: 8, ago: 8, agost: 8,
    septiembre: 9, setiembre: 9, sept: 9, sep: 9, set: 9,
    octubre: 10, oct: 10,
    noviembre: 11, nov: 11,
    diciembre: 12, dic: 12,
};

const MONTH_LABELS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// Rango de cordura: fuera de aquí es casi seguro una errata de tecleo.
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

// Las hojas de cálculo cuentan días desde el 30/12/1899 (el "bug" de 1900 de Lotus).
const SERIAL_EPOCH = Date.UTC(1899, 11, 30);
const SERIAL_MIN = 20000; // ~1954
const SERIAL_MAX = 60000; // ~2064

/** Minúsculas, sin acentos y sin espacios redundantes. Útil también para nombres. */
export function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function buildDate(day, month, year, { allowSwap = false } = {}) {
    if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;

    // Años de dos dígitos: "26" -> 2026. Tres dígitos es siempre una errata.
    let fullYear = year;
    if (fullYear >= 0 && fullYear < 100) fullYear += 2000;
    if (fullYear < MIN_YEAR || fullYear > MAX_YEAR) return null;

    // Alguien ha escrito mes/día en vez de día/mes (formato americano).
    let d = day;
    let m = month;
    let swapped = false;
    if (m > 12 && d <= 12 && allowSwap) {
        [d, m] = [m, d];
        swapped = true;
    }

    if (m < 1 || m > 12 || d < 1 || d > 31) return null;

    const date = new Date(fullYear, m - 1, d);
    // Descarta fechas imposibles tipo 31/02: el constructor las desborda al mes siguiente.
    if (date.getFullYear() !== fullYear || date.getMonth() !== m - 1 || date.getDate() !== d) return null;

    return { date, swapped };
}

/**
 * Interpreta una fecha escrita a mano.
 * @returns {{date: Date|null, iso: string|null, ambigua: boolean, motivo: string|null}}
 *   `motivo` explica por qué no se pudo interpretar ('vacia' | 'formato_desconocido').
 *   `ambigua` marca las que se han recuperado invirtiendo día y mes.
 */
export function parseSheetDateDetailed(raw) {
    if (raw instanceof Date) {
        return Number.isNaN(raw.getTime())
            ? { date: null, iso: null, ambigua: false, motivo: 'formato_desconocido' }
            : { date: raw, iso: formatISODate(raw), ambigua: false, motivo: null };
    }

    const text = normalizeText(raw)
        .replace(/[,"']/g, ' ')
        .replace(/\bde[l]?\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!text) return { date: null, iso: null, ambigua: false, motivo: 'vacia' };

    const tokens = text.split(/[/\-.\s]+/).filter(Boolean);
    let built = null;

    if (tokens.length === 3) {
        const [a, b, c] = tokens;
        const monthByName = MONTH_NAMES[b];

        if (monthByName && /^\d+$/.test(a) && /^\d+$/.test(c)) {
            // "3 junio 2026"
            built = buildDate(Number(a), monthByName, Number(c));
        } else if (/^\d+$/.test(a) && /^\d+$/.test(b) && /^\d+$/.test(c)) {
            built = a.length === 4
                ? buildDate(Number(c), Number(b), Number(a)) // ISO: 2026-06-03
                : buildDate(Number(a), Number(b), Number(c), { allowSwap: true });
        }
    } else if (tokens.length === 1 && /^\d+$/.test(tokens[0])) {
        const digits = tokens[0];
        if (digits.length === 8) {
            // 03062026
            built = buildDate(Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4)));
        } else if (digits.length === 6) {
            // 030626
            built = buildDate(Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4)));
        } else if (digits.length === 5) {
            // Número de serie de hoja de cálculo (celda con formato numérico).
            const serial = Number(digits);
            if (serial >= SERIAL_MIN && serial <= SERIAL_MAX) {
                const utc = new Date(SERIAL_EPOCH + serial * 86400000);
                built = { date: new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate()), swapped: false };
            }
        }
    }

    if (!built) return { date: null, iso: null, ambigua: false, motivo: 'formato_desconocido' };
    return { date: built.date, iso: formatISODate(built.date), ambigua: built.swapped, motivo: null };
}

/** Versión corta: la fecha o `null`. Es la que usa el resto del código. */
export function parseSheetDate(raw) {
    return parseSheetDateDetailed(raw).date;
}

/** 'YYYY-MM-DD' en hora local. */
export function formatISODate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const y = String(date.getFullYear()).padStart(4, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** 'DD/MM/YYYY', el formato que la gente ve en el Sheet. */
export function formatSheetDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${d}/${m}/${date.getFullYear()}`;
}

export function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function endOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

/** Días completos entre dos fechas (b - a). */
export function daysBetween(a, b) {
    return Math.floor((startOfDay(b) - startOfDay(a)) / 86400000);
}

/** Lunes de la semana de `date` (convención española: la semana empieza en lunes). */
function startOfWeek(date) {
    const d = startOfDay(date);
    const offset = (d.getDay() + 6) % 7; // domingo = 0 -> 6
    d.setDate(d.getDate() - offset);
    return d;
}

function addMonths(date, months) {
    const d = new Date(date.getTime());
    const targetDay = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    // Si el mes destino es más corto (31 de marzo -> febrero), nos quedamos en su último día.
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(targetDay, lastDay));
    return d;
}

/** Periodos relativos que el servidor resuelve por su cuenta: el agente no necesita saber qué día es hoy. */
export const PERIODOS = [
    'hoy',
    'ayer',
    'esta_semana',
    'semana_pasada',
    'ultimos_7_dias',
    'este_mes',
    'mes_pasado',
    'ultimos_30_dias',
    'ultimos_3_meses',
    'ultimos_6_meses',
    'ultimo_ano',
    'este_ano',
    'ano_pasado',
];

export function resolvePeriodo(periodo, now = new Date()) {
    const hoy = startOfDay(now);

    switch (periodo) {
        case 'hoy':
            return { desde: hoy, hasta: endOfDay(hoy), etiqueta: 'hoy' };
        case 'ayer': {
            const ayer = new Date(hoy.getTime());
            ayer.setDate(ayer.getDate() - 1);
            return { desde: ayer, hasta: endOfDay(ayer), etiqueta: 'ayer' };
        }
        case 'esta_semana': {
            const lunes = startOfWeek(hoy);
            return { desde: lunes, hasta: endOfDay(hoy), etiqueta: 'esta semana' };
        }
        case 'semana_pasada': {
            const lunes = startOfWeek(hoy);
            const inicio = new Date(lunes.getTime());
            inicio.setDate(inicio.getDate() - 7);
            const fin = new Date(lunes.getTime());
            fin.setDate(fin.getDate() - 1);
            return { desde: inicio, hasta: endOfDay(fin), etiqueta: 'la semana pasada' };
        }
        case 'ultimos_7_dias': {
            const inicio = new Date(hoy.getTime());
            inicio.setDate(inicio.getDate() - 6);
            return { desde: inicio, hasta: endOfDay(hoy), etiqueta: 'los últimos 7 días' };
        }
        case 'este_mes': {
            const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
            return { desde: inicio, hasta: endOfDay(hoy), etiqueta: `${MONTH_LABELS[hoy.getMonth()]} de ${hoy.getFullYear()}` };
        }
        case 'mes_pasado': {
            const inicio = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
            const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
            return { desde: inicio, hasta: endOfDay(fin), etiqueta: `${MONTH_LABELS[inicio.getMonth()]} de ${inicio.getFullYear()}` };
        }
        case 'ultimos_30_dias': {
            const inicio = new Date(hoy.getTime());
            inicio.setDate(inicio.getDate() - 29);
            return { desde: inicio, hasta: endOfDay(hoy), etiqueta: 'los últimos 30 días' };
        }
        case 'ultimos_3_meses':
            return { desde: addMonths(hoy, -3), hasta: endOfDay(hoy), etiqueta: 'los últimos 3 meses' };
        case 'ultimos_6_meses':
            return { desde: addMonths(hoy, -6), hasta: endOfDay(hoy), etiqueta: 'los últimos 6 meses' };
        case 'ultimo_ano':
            return { desde: addMonths(hoy, -12), hasta: endOfDay(hoy), etiqueta: 'el último año' };
        case 'este_ano':
            return { desde: new Date(hoy.getFullYear(), 0, 1), hasta: endOfDay(hoy), etiqueta: `${hoy.getFullYear()}` };
        case 'ano_pasado': {
            const y = hoy.getFullYear() - 1;
            return { desde: new Date(y, 0, 1), hasta: endOfDay(new Date(y, 11, 31)), etiqueta: `${y}` };
        }
        default:
            return null;
    }
}

/**
 * Resuelve un mes concreto: 'YYYY-MM', 'MM/YYYY', 'junio' o 'junio 2026'.
 * Un nombre de mes sin año se interpreta como la última vez que ocurrió: en
 * agosto de 2026, "junio" es junio de 2026; en marzo de 2026, junio de 2025.
 */
export function resolveMes(mes, now = new Date()) {
    const text = normalizeText(mes).replace(/\bde[l]?\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return null;

    const tokens = text.split(/[/\-.\s]+/).filter(Boolean);
    let month = null;
    let year = null;

    if (tokens.length === 1) {
        if (MONTH_NAMES[tokens[0]]) {
            month = MONTH_NAMES[tokens[0]];
        } else if (/^\d{6}$/.test(tokens[0])) {
            year = Number(tokens[0].slice(0, 4));
            month = Number(tokens[0].slice(4));
        }
    } else if (tokens.length === 2) {
        const [a, b] = tokens;
        if (MONTH_NAMES[a] && /^\d+$/.test(b)) {
            month = MONTH_NAMES[a];
            year = Number(b);
        } else if (MONTH_NAMES[b] && /^\d+$/.test(a)) {
            month = MONTH_NAMES[b];
            year = Number(a);
        } else if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
            // '2026-06' o '06/2026'
            if (a.length === 4) { year = Number(a); month = Number(b); }
            else { month = Number(a); year = Number(b); }
        }
    }

    if (!month || month < 1 || month > 12) return null;

    if (year === null) {
        // Sin año: el mes más reciente que ya ha empezado.
        year = month <= now.getMonth() + 1 ? now.getFullYear() : now.getFullYear() - 1;
    }
    if (year < 100) year += 2000;
    if (year < MIN_YEAR || year > MAX_YEAR) return null;

    return {
        desde: new Date(year, month - 1, 1),
        hasta: endOfDay(new Date(year, month, 0)),
        etiqueta: `${MONTH_LABELS[month - 1]} de ${year}`,
    };
}

/**
 * Resuelve el rango de una consulta a partir de los parámetros de una tool.
 *
 * Precedencia (documentada en las descripciones de las tools): desde/hasta >
 * mes > periodo. Si se pasan parámetros que quedan ignorados se devuelve un
 * aviso, para que la respuesta pueda decir qué rango se usó realmente.
 *
 * @returns {{desde: Date|null, hasta: Date|null, etiqueta: string, avisos: string[], error: string|null}}
 */
export function resolveRango({ desde, hasta, mes, periodo, now = new Date() } = {}) {
    const avisos = [];
    const usados = [];
    if (desde || hasta) usados.push('desde/hasta');
    if (mes) usados.push('mes');
    if (periodo) usados.push('periodo');
    if (usados.length > 1) {
        avisos.push(`Se han recibido varios filtros de fecha (${usados.join(', ')}); se ha usado "${usados[0]}".`);
    }

    if (desde || hasta) {
        const d = desde ? parseSheetDate(desde) : null;
        const h = hasta ? parseSheetDate(hasta) : null;
        if (desde && !d) return { desde: null, hasta: null, etiqueta: '', avisos, error: `No se entiende la fecha "desde": "${desde}". Usa el formato YYYY-MM-DD.` };
        if (hasta && !h) return { desde: null, hasta: null, etiqueta: '', avisos, error: `No se entiende la fecha "hasta": "${hasta}". Usa el formato YYYY-MM-DD.` };

        const inicio = d ? startOfDay(d) : null;
        const fin = h ? endOfDay(h) : endOfDay(now);
        if (inicio && fin && inicio > fin) {
            return { desde: null, hasta: null, etiqueta: '', avisos, error: 'El rango es inválido: "desde" es posterior a "hasta".' };
        }
        const etiqueta = inicio
            ? `del ${formatSheetDate(inicio)} al ${formatSheetDate(fin)}`
            : `hasta el ${formatSheetDate(fin)}`;
        return { desde: inicio, hasta: fin, etiqueta, avisos, error: null };
    }

    if (mes) {
        const r = resolveMes(mes, now);
        if (!r) return { desde: null, hasta: null, etiqueta: '', avisos, error: `No se entiende el mes "${mes}". Usa 'YYYY-MM' o el nombre del mes.` };
        return { ...r, avisos, error: null };
    }

    if (periodo) {
        const r = resolvePeriodo(periodo, now);
        if (!r) return { desde: null, hasta: null, etiqueta: '', avisos, error: `Periodo desconocido: "${periodo}".` };
        return { ...r, avisos, error: null };
    }

    return { desde: null, hasta: null, etiqueta: 'todo el historial disponible', avisos, error: null };
}

/** ¿Cae `date` dentro del rango? Los extremos `null` dejan el rango abierto por ese lado. */
export function isWithinRange(date, desde, hasta) {
    if (!(date instanceof Date)) return false;
    if (desde && date < desde) return false;
    if (hasta && date > hasta) return false;
    return true;
}

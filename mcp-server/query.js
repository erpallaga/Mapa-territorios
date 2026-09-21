/**
 * Helpers de consulta compartidos por las tools del MCP.
 *
 * La idea es que `tools.js` se quede con la definición de los schemas y el
 * formato de salida, y que aquí viva la lógica de recorrer el historial, contar
 * y agrupar. Todo se apoya en `src/lib/dates.js`, que es quien sabe interpretar
 * las fechas escritas a mano en el Sheet.
 */

import {
    daysBetween,
    formatISODate,
    formatSheetDate,
    isWithinRange,
    normalizeText,
    parseSheetDate,
    parseSheetDateDetailed,
    startOfDay,
} from "../src/lib/dates.js";
import { ultimaFinalizacion } from "../src/lib/completion.js";
import { DIAS_VENCIMIENTO } from "../src/lib/sheets.js";

/** Coincidencia parcial sin distinguir mayúsculas ni acentos ("nuria" encuentra "Núria"). */
export function coincideTexto(valor, aguja) {
    if (!aguja) return true;
    return normalizeText(valor).includes(normalizeText(aguja));
}

/**
 * Convierte el historial de todos los territorios en una lista plana de eventos
 * datados, que es lo que permite responder "qué pasó entre X e Y".
 *
 * Cada asignación del Sheet puede generar hasta dos eventos: la asignación
 * (`assignedDate`) y la finalización/devolución (`completedDate`). El Sheet no
 * distingue "devuelto" de "trabajado": es la misma columna.
 *
 * @returns {{eventos: Array, fechasNoReconocidas: number, fechasAmbiguas: number}}
 */
export function extraerEventos(territorios, { desde = null, hasta = null, tipos = ["asignacion", "finalizacion"], zona = null, publicador = null } = {}) {
    const eventos = [];
    let fechasNoReconocidas = 0;
    let fechasAmbiguas = 0;

    const quiereAsignaciones = tipos.includes("asignacion");
    const quiereFinalizaciones = tipos.includes("finalizacion");

    for (const t of territorios) {
        if (zona && !coincideTexto(t.zone, zona)) continue;

        t.history.forEach((h, idx) => {
            if (publicador && !coincideTexto(h.publisher, publicador)) return;

            // La primera entrada del historial es la más reciente (sheets.js lo invierte).
            const esAsignacionActual = idx === 0 && t.status === "assigned";

            const candidatos = [];
            if (quiereAsignaciones) candidatos.push(["asignacion", h.assignedDate]);
            if (quiereFinalizaciones) candidatos.push(["finalizacion", h.completedDate]);

            for (const [tipo, raw] of candidatos) {
                const parsed = parseSheetDateDetailed(raw);
                if (!parsed.date) {
                    // Sólo cuenta como "no reconocida" si había algo escrito.
                    if (parsed.motivo === "formato_desconocido") fechasNoReconocidas++;
                    continue;
                }
                if (parsed.ambigua) fechasAmbiguas++;
                if (!isWithinRange(parsed.date, desde, hasta)) continue;

                eventos.push({
                    id: t.id,
                    zona: t.zone || null,
                    publicador: h.publisher || null,
                    tipo,
                    fecha: formatISODate(parsed.date),
                    fechaObj: parsed.date,
                    enCurso: tipo === "asignacion" && esAsignacionActual,
                });
            }
        });
    }

    eventos.sort((a, b) => b.fechaObj - a.fechaObj || String(a.id).localeCompare(String(b.id)));
    return { eventos, fechasNoReconocidas, fechasAmbiguas };
}

/**
 * Índice de publicadores a partir del historial.
 *
 * Los nombres se escriben a mano, así que "Ana López", "ana lopez" y
 * "Ana  Lopez" son la misma persona. Se agrupan por su forma normalizada y se
 * elige como nombre canónico la grafía más repetida.
 *
 * @returns {Map<string, {clave: string, nombre: string, variantes: string[]}>}
 */
export function indexarPublicadores(territorios) {
    const grafias = new Map(); // clave normalizada -> Map<grafía, veces>

    for (const t of territorios) {
        for (const h of t.history) {
            if (!h.publisher || !h.publisher.trim()) continue;
            const clave = normalizeText(h.publisher);
            if (!clave) continue;
            if (!grafias.has(clave)) grafias.set(clave, new Map());
            const cuenta = grafias.get(clave);
            const grafia = h.publisher.trim().replace(/\s+/g, " ");
            cuenta.set(grafia, (cuenta.get(grafia) || 0) + 1);
        }
    }

    const indice = new Map();
    for (const [clave, cuenta] of grafias) {
        const orden = [...cuenta.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        indice.set(clave, {
            clave,
            nombre: orden[0][0],
            variantes: orden.length > 1 ? orden.map(([g]) => g) : [],
        });
    }
    return indice;
}

/** Nombre canónico de un publicador tal y como debe citarse en la respuesta. */
export function nombreCanonico(indice, publisher) {
    return indice.get(normalizeText(publisher))?.nombre || (publisher || "").trim() || null;
}

/**
 * Última vez que un territorio se completó. La implementación vive en
 * `src/lib/completion.js` para que el MCP, el mapa y el panel contesten lo
 * mismo; se reexporta aquí porque es como la conocen las tools.
 */
export { ultimaFinalizacion };

/**
 * Cuándo vence la asignación actual, como dato y no como cuenta que el modelo
 * tenga que echar de memoria.
 *
 * Existía sólo el aviso de "vencido", que aparece cuando ya es tarde, así que a
 * la pregunta "¿cuándo caduca?" el modelo respondía sumando "cuatro meses" en
 * prosa — y cuatro meses no son 122 días salvo por casualidad: una asignación
 * del 07/07 vence el 06/11, no el 07/11. La regla sale de `DIAS_VENCIMIENTO`,
 * la misma constante con la que el panel decide si pintarlo de rojo.
 *
 * @returns {{fecha: Date|null, dias: number|null}} `dias` es lo que queda para
 *   vencer; negativo si ya venció. Ambos `null` si el territorio está libre o
 *   si su fecha de asignación no se puede leer.
 */
export function caducidad(territorio, hoy = new Date()) {
    if (territorio?.status !== "assigned") return { fecha: null, dias: null };
    const asignada = parseSheetDate(territorio.assignedDate);
    if (!asignada) return { fecha: null, dias: null };

    const fecha = startOfDay(asignada);
    fecha.setDate(fecha.getDate() + DIAS_VENCIMIENTO);
    return { fecha, dias: daysBetween(hoy, fecha) };
}

/** La caducidad ya formateada para la salida de las tools. */
export function caducidadNormalizada(territorio, hoy = new Date()) {
    const { fecha, dias } = caducidad(territorio, hoy);
    return {
        fechaCaducidad: fecha ? formatISODate(fecha) : null,
        diasParaCaducar: dias,
    };
}

/** Media de días entre asignación y finalización, sobre las asignaciones ya cerradas. */
export function diasMediosRetencion(entradas) {
    const duraciones = [];
    for (const h of entradas) {
        const a = parseSheetDate(h.assignedDate);
        const c = parseSheetDate(h.completedDate);
        if (a && c && c >= a) duraciones.push(daysBetween(a, c));
    }
    if (duraciones.length === 0) return null;
    return Math.round(duraciones.reduce((acc, d) => acc + d, 0) / duraciones.length);
}

/** Paginación uniforme: todas las tools devuelven la misma forma. */
export function paginar(items, offset, limit) {
    const total = items.length;
    const page = items.slice(offset, offset + limit);
    const hasMore = total > offset + page.length;
    return {
        page,
        meta: {
            total,
            count: page.length,
            offset,
            has_more: hasMore,
            ...(hasMore ? { next_offset: offset + page.length } : {}),
        },
    };
}

/**
 * Presenta una fecha del Sheet ya normalizada.
 *
 * El objetivo es que nunca se cuele en la respuesta una fecha tal cual está
 * escrita ("45810", "6/25/2026"): en `structuredContent` va siempre ISO o null,
 * y en el texto se ve en formato español. Si no hay manera de interpretarla, el
 * texto lo dice explícitamente en vez de disimularlo.
 */
export function fechaNormalizada(raw) {
    const d = parseSheetDate(raw);
    if (d) return { iso: formatISODate(d), texto: formatSheetDate(d) };
    const bruto = String(raw ?? "").trim();
    return { iso: null, texto: bruto ? `"${bruto}" (fecha no reconocida)` : "sin fecha" };
}

/** Plural simple, para no acabar diciendo "1 meses". */
export function plural(n, singular, pluralForma) {
    return `${n} ${n === 1 ? singular : pluralForma}`;
}

/** Devuelve el error de una tool en el formato que espera el protocolo MCP. */
export function errorTool(mensaje) {
    return { isError: true, content: [{ type: "text", text: mensaje }] };
}

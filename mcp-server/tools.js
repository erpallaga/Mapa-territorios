import { z } from "zod";
import { getTerritories } from "./data.js";
import {
  PERIODOS,
  daysBetween,
  formatISODate,
  formatSheetDate,
  isWithinRange,
  normalizeText,
  parseSheetDate,
  resolveRango,
} from "../src/lib/dates.js";
import {
  coincideTexto,
  diasMediosRetencion,
  errorTool,
  fechaNormalizada,
  plural,
  extraerEventos,
  indexarPublicadores,
  nombreCanonico,
  paginar,
  ultimaFinalizacion,
} from "./query.js";

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// Los rangos de fechas se resuelven en el servidor: el agente no sabe qué día
// es hoy, así que pedirle que calcule "la semana pasada" es pedirle que se lo
// invente. Estos cuatro campos se repiten en todas las tools con fechas.
const CAMPOS_FECHA = {
  periodo: z.enum(PERIODOS).optional()
    .describe("Periodo relativo resuelto por el servidor: 'hoy', 'ayer', 'esta_semana', 'semana_pasada', 'ultimos_7_dias', 'este_mes', 'mes_pasado', 'ultimos_30_dias', 'ultimos_3_meses', 'ultimos_6_meses', 'ultimo_ano', 'este_ano', 'ano_pasado'. Es la forma preferida: NO calcules tú las fechas."),
  mes: z.string().optional()
    .describe("Un mes concreto: 'YYYY-MM' (ej. '2026-06') o su nombre ('junio', 'junio 2026'). Sin año se entiende la última vez que ocurrió ese mes."),
  desde: z.string().optional()
    .describe("Inicio del rango en formato YYYY-MM-DD. Úsalo solo para rangos que no encajen en 'periodo' ni 'mes'."),
  hasta: z.string().optional()
    .describe("Fin del rango en formato YYYY-MM-DD (incluido). Si se omite y hay 'desde', el rango llega hasta hoy."),
};

const CAMPOS_PAGINACION = {
  limit: z.number().int().min(1).max(100).default(50).describe("Máximo de resultados (1-100)"),
  offset: z.number().int().min(0).default(0).describe("Resultados a saltar, para paginación"),
};

/** Bloque común de salida: qué rango se ha usado realmente y qué se ha ignorado. */
function describirRango(rango, fechasNoReconocidas = 0, fechasAmbiguas = 0) {
  const avisos = [...rango.avisos];
  if (fechasNoReconocidas > 0) {
    avisos.push(`${fechasNoReconocidas} fecha(s) del Sheet no se han podido interpretar y quedan fuera del recuento.`);
  }
  if (fechasAmbiguas > 0) {
    avisos.push(`${fechasAmbiguas} fecha(s) parecían tener el día y el mes invertidos; se han corregido.`);
  }
  return {
    rangoResuelto: {
      desde: rango.desde ? formatISODate(rango.desde) : null,
      hasta: rango.hasta ? formatISODate(rango.hasta) : null,
      etiqueta: rango.etiqueta,
    },
    ...(avisos.length > 0 ? { avisos } : {}),
  };
}

export function registerTerritorioTools(server) {
  const ListInputSchema = z.object({
    estado: z.enum(["libre", "asignado", "todos"])
      .default("todos")
      .describe("Filtrar por estado: 'libre', 'asignado', o 'todos'"),
    zona: z.string()
      .optional()
      .describe("Filtrar por zona (coincidencia parcial, sin distinguir mayúsculas)"),
    limit: z.number().int().min(1).max(100).default(50)
      .describe("Máximo de resultados a devolver (1-100)"),
    offset: z.number().int().min(0).default(0)
      .describe("Número de resultados a saltar, para paginación")
  }).strict();

  server.registerTool(
    "territorios_listar",
    {
      title: "Listar Territorios",
      description: `Lista territorios con su estado actual (libre/asignado), zona y datos de asignación.
Solo lectura, no modifica nada.

Args:
  - estado ('libre'|'asignado'|'todos'): filtra por estado. Por defecto 'todos'.
  - zona (string, opcional): filtra por zona, coincidencia parcial.
  - limit (number): máximo de resultados (1-100, por defecto 50).
  - offset (number): resultados a saltar para paginación (por defecto 0).

Devuelve por cada territorio: id, zona, estado, número de viviendas, publicador actual,
fecha de asignación, si está vencido (asignado hace más de 4 meses) y días de retraso.`,
      inputSchema: ListInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ estado, zona, limit, offset }) => {
      const all = await getTerritories();
      // Los nombres se escriben a mano: todas las tools citan la misma grafía.
      const indice = indexarPublicadores(all);

      let filtered = all;
      if (estado !== "todos") {
        const target = estado === "libre" ? "free" : "assigned";
        filtered = filtered.filter((t) => t.status === target);
      }
      if (zona) {
        const zonaLower = zona.toLowerCase();
        filtered = filtered.filter((t) => (t.zone || "").toLowerCase().includes(zonaLower));
      }

      const total = filtered.length;
      const page = filtered.slice(offset, offset + limit);

      const items = page.map((t) => ({
        id: t.id,
        zona: t.zone,
        estado: t.status === "free" ? "libre" : "asignado",
        numViviendas: t.numViviendas,
        // El campo "publisher" del Sheet conserva el último nombre aunque el
        // territorio ya esté libre de nuevo, así que solo lo mostramos si
        // realmente sigue asignado.
        publicador: t.status === "assigned" ? nombreCanonico(indice, t.publisher) : null,
        fechaAsignacion: t.status === "assigned" ? fechaNormalizada(t.assignedDate).iso : null,
        vencido: t.isExpired,
        diasVencido: t.isExpired ? t.expiredDays : null
      }));

      const output = {
        total,
        count: items.length,
        offset,
        territorios: items,
        has_more: total > offset + items.length,
        ...(total > offset + items.length ? { next_offset: offset + items.length } : {})
      };

      const lines = [`# Territorios (${total} encontrados, mostrando ${items.length})`, ""];
      for (const t of items) {
        const marca = t.vencido ? ` ⚠️ vencido (${t.diasVencido} días)` : "";
        lines.push(`- **Territorio ${t.id}** (${t.zona || "sin zona"}): ${t.estado}${t.publicador ? ` — ${t.publicador}` : ""}${marca}`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  const GetByIdInputSchema = z.object({
    id: z.string().min(1).describe("Número/ID del territorio, ej. '45'")
  }).strict();

  server.registerTool(
    "territorios_buscar_por_id",
    {
      title: "Buscar Territorio por ID",
      description: `Devuelve el detalle completo de un territorio concreto, incluyendo su historial de asignaciones.
Solo lectura.

Args:
  - id (string): número de territorio, ej. "45".

Devuelve: zona, estado, número de viviendas, publicador actual, fecha de asignación, si está vencido,
última fecha de finalización, finalizaciones en los últimos 12 meses, e historial completo de
asignaciones (del más reciente al más antiguo).

Si el ID no existe, devuelve un mensaje de error indicándolo.`,
      inputSchema: GetByIdInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ id }) => {
      const all = await getTerritories();
      const indice = indexarPublicadores(all);
      const t = all.find((x) => x.id === id);

      if (!t) {
        return {
          isError: true,
          content: [{ type: "text", text: `No se encontró el territorio con ID "${id}". Usa territorios_listar para ver los IDs disponibles.` }]
        };
      }

      const output = {
        id: t.id,
        zona: t.zone,
        estado: t.status === "free" ? "libre" : "asignado",
        numViviendas: t.numViviendas,
        // Igual que en territorios_listar: no mostrar un publicador "actual"
        // que en realidad es el último dato del historial de un territorio
        // ya liberado.
        publicador: t.status === "assigned" ? nombreCanonico(indice, t.publisher) : null,
        fechaAsignacion: t.status === "assigned" ? fechaNormalizada(t.assignedDate).iso : null,
        ultimaFechaCompletado: fechaNormalizada(t.lastCompletedDate).iso,
        finalizacionesUltimos12Meses: t.completionCount12m,
        vencido: t.isExpired,
        diasVencido: t.isExpired ? t.expiredDays : null,
        historial: t.history.map((h) => ({
          publicador: nombreCanonico(indice, h.publisher),
          fechaAsignacion: fechaNormalizada(h.assignedDate).iso,
          fechaCompletado: fechaNormalizada(h.completedDate).iso
        }))
      };

      const lines = [`# Territorio ${t.id} (${t.zone || "sin zona"})`, "", `**Estado:** ${output.estado}`];
      if (output.publicador) lines.push(`**Publicador actual:** ${output.publicador} (asignado ${fechaNormalizada(t.assignedDate).texto})`);
      if (output.vencido) lines.push(`⚠️ **Vencido** hace ${output.diasVencido} días`);
      lines.push("", "## Historial", "");
      if (t.history.length === 0) {
        lines.push("Sin historial registrado.");
      } else {
        for (const h of t.history) {
          const asignada = fechaNormalizada(h.assignedDate);
          const completada = fechaNormalizada(h.completedDate);
          lines.push(`- ${nombreCanonico(indice, h.publisher)}: asignado ${asignada.texto}${completada.iso ? `, completado ${completada.texto}` : " (en curso)"}`);
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  const ExpiredInputSchema = z.object({
    zona: z.string().optional().describe("Filtrar por zona (coincidencia parcial)"),
    limit: z.number().int().min(1).max(100).default(50).describe("Máximo de resultados"),
    offset: z.number().int().min(0).default(0).describe("Resultados a saltar, para paginación")
  }).strict();

  server.registerTool(
    "territorios_vencidos",
    {
      title: "Territorios Vencidos",
      description: `Lista los territorios asignados desde hace más de 4 meses, ordenados de más a menos días de retraso.
Solo lectura.

Args:
  - zona (string, opcional): filtra por zona, coincidencia parcial.
  - limit (number): máximo de resultados (1-100, por defecto 50).
  - offset (number): resultados a saltar para paginación.

Devuelve por cada territorio: id, zona, publicador, fecha de asignación y días de retraso.`,
      inputSchema: ExpiredInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ zona, limit, offset }) => {
      const all = await getTerritories();
      const indice = indexarPublicadores(all);

      let expired = all.filter((t) => t.isExpired);
      if (zona) {
        const zonaLower = zona.toLowerCase();
        expired = expired.filter((t) => (t.zone || "").toLowerCase().includes(zonaLower));
      }
      expired.sort((a, b) => b.expiredDays - a.expiredDays);

      const total = expired.length;
      const page = expired.slice(offset, offset + limit);
      const items = page.map((t) => ({
        id: t.id, zona: t.zone, publicador: nombreCanonico(indice, t.publisher),
        fechaAsignacion: fechaNormalizada(t.assignedDate).iso, diasVencido: t.expiredDays
      }));

      const output = {
        total, count: items.length, offset, territorios: items,
        has_more: total > offset + items.length,
        ...(total > offset + items.length ? { next_offset: offset + items.length } : {})
      };

      const lines = [`# Territorios vencidos (${total} encontrados, mostrando ${items.length})`, ""];
      for (const t of items) {
        lines.push(`- **Territorio ${t.id}** (${t.zona || "sin zona"}): ${t.publicador || "sin publicador"}, vencido hace ${t.diasVencido} días`);
      }
      if (items.length === 0) lines.push("Ningún territorio vencido con esos filtros.");

      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  server.registerTool(
    "territorios_estadisticas",
    {
      title: "Estadísticas de Territorios",
      description: `Devuelve un resumen estadístico global: totales, libres, asignados, vencidos, y desglose por zona.
Solo lectura, sin parámetros.

Devuelve: total, libres, asignados, vencidos (números globales), y porZona (array con
{ zona, total, libres, asignados, vencidos } por cada zona).`,
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      const all = await getTerritories();

      const total = all.length;
      const libres = all.filter((t) => t.status === "free").length;
      const asignados = total - libres;
      const vencidos = all.filter((t) => t.isExpired).length;

      const porZonaMap = new Map();
      for (const t of all) {
        const zona = t.zone || "Sin zona";
        if (!porZonaMap.has(zona)) porZonaMap.set(zona, { zona, total: 0, libres: 0, asignados: 0, vencidos: 0 });
        const z = porZonaMap.get(zona);
        z.total++;
        if (t.status === "free") z.libres++; else z.asignados++;
        if (t.isExpired) z.vencidos++;
      }
      const porZona = Array.from(porZonaMap.values()).sort((a, b) => a.zona.localeCompare(b.zona));

      const output = { total, libres, asignados, vencidos, porZona };
      const lines = [
        "# Estadísticas de Territorios", "",
        `- **Total:** ${total}`, `- **Libres:** ${libres}`, `- **Asignados:** ${asignados}`, `- **Vencidos:** ${vencidos}`,
        "", "## Por zona", ""
      ];
      for (const z of porZona) {
        lines.push(`- **${z.zona}**: ${z.total} total, ${z.libres} libres, ${z.asignados} asignados, ${z.vencidos} vencidos`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  const PublisherInputSchema = z.object({
    publicador: z.string().min(1).describe("Nombre (o parte del nombre) del publicador. Coincidencia parcial, sin distinguir mayúsculas ni acentos."),
    soloActuales: z.boolean().optional()
      .describe("true = solo lo que tiene asignado ahora mismo. false = también el historial. Si se omite: true cuando no se indica ningún filtro de fecha, false cuando sí (porque preguntar por un periodo es preguntar por el historial)."),
    ...CAMPOS_FECHA,
    ...CAMPOS_PAGINACION
  }).strict();

  server.registerTool(
    "territorios_buscar_por_publicador",
    {
      title: "Buscar Territorios por Publicador",
      description: `Todo lo relacionado con un publicador concreto: qué tiene asignado ahora y qué ha trabajado en un periodo.
Solo lectura.

Úsala para "¿qué territorios tiene Eric?", "¿qué ha trabajado Raquel en los últimos 6 meses?",
"¿cuánto tarda Ana en devolver un territorio?".

Args:
  - publicador (string): nombre o parte del nombre.
  - soloActuales (boolean, opcional): ver arriba. Por defecto se ajusta solo según si hay filtro de fecha.
  - periodo / mes / desde / hasta: acotan el historial. Precedencia: desde/hasta > mes > periodo.
  - limit / offset: paginación.

Devuelve un bloque "resumen" (territorios actuales, vencidos, asignaciones y finalizaciones del
periodo, días medios que retiene un territorio, última actividad) y la lista de coincidencias.
Si el nombre coincide con varias personas, "resumen.nombresCoincidentes" las lista: úsalo para
repreguntar o para afinar la búsqueda. Los ids devueltos sirven para territorios_buscar_por_id.`,
      inputSchema: PublisherInputSchema,
      annotations: ANNOTATIONS
    },
    async ({ publicador, soloActuales, periodo, mes, desde, hasta, limit, offset }) => {
      const all = await getTerritories();
      const rango = resolveRango({ desde, hasta, mes, periodo });
      if (rango.error) return errorTool(rango.error);

      const hayRango = Boolean(rango.desde || rango.hasta);
      // Preguntar por un periodo es preguntar por el historial: si el llamante
      // no se pronuncia, la presencia de fechas decide.
      const onlyCurrent = soloActuales ?? !hayRango;

      const indice = indexarPublicadores(all);
      const nombresCoincidentes = [...indice.values()]
        .filter((p) => coincideTexto(p.nombre, publicador))
        .map((p) => p.nombre)
        .sort((a, b) => a.localeCompare(b));

      // Lo que tiene asignado ahora: el campo "publisher" arrastra el último
      // nombre del historial aunque el territorio ya esté libre, así que exigimos
      // además que el estado siga siendo "asignado".
      const actuales = all.filter(
        (t) => t.status === "assigned" && coincideTexto(t.publisher, publicador)
      );

      const entradasHistorial = [];
      for (const t of all) {
        t.history.forEach((h, idx) => {
          if (!coincideTexto(h.publisher, publicador)) return;
          entradasHistorial.push({ t, h, esActual: idx === 0 && t.status === "assigned" });
        });
      }

      const enRango = entradasHistorial.filter(({ h }) => {
        if (!hayRango) return true;
        const a = parseSheetDate(h.assignedDate);
        const c = parseSheetDate(h.completedDate);
        return isWithinRange(a, rango.desde, rango.hasta) || isWithinRange(c, rango.desde, rango.hasta);
      });

      let coincidencias;
      if (onlyCurrent) {
        coincidencias = actuales
          .filter((t) => !hayRango || isWithinRange(parseSheetDate(t.assignedDate), rango.desde, rango.hasta))
          .map((t) => ({
            id: t.id,
            zona: t.zone || null,
            tipo: "actual",
            publicador: nombreCanonico(indice, t.publisher),
            fechaAsignacion: fechaNormalizada(t.assignedDate).iso,
            diasAsignado: parseSheetDate(t.assignedDate) ? daysBetween(parseSheetDate(t.assignedDate), new Date()) : null,
            vencido: t.isExpired,
            diasVencido: t.isExpired ? t.expiredDays : null
          }));
      } else {
        coincidencias = enRango.map(({ t, h, esActual }) => ({
          id: t.id,
          zona: t.zone || null,
          tipo: esActual ? "actual" : "historico",
          publicador: nombreCanonico(indice, h.publisher),
          fechaAsignacion: fechaNormalizada(h.assignedDate).iso,
          fechaCompletado: fechaNormalizada(h.completedDate).iso,
          vencido: esActual ? t.isExpired : false,
          diasVencido: esActual && t.isExpired ? t.expiredDays : null
        }));
        coincidencias.sort((a, b) => {
          const fa = parseSheetDate(a.fechaCompletado) || parseSheetDate(a.fechaAsignacion) || 0;
          const fb = parseSheetDate(b.fechaCompletado) || parseSheetDate(b.fechaAsignacion) || 0;
          return fb - fa;
        });
      }

      const asignacionesEnRango = enRango.filter(({ h }) =>
        isWithinRange(parseSheetDate(h.assignedDate), rango.desde, rango.hasta)).length;
      const finalizacionesEnRango = enRango.filter(({ h }) =>
        isWithinRange(parseSheetDate(h.completedDate), rango.desde, rango.hasta)).length;

      let ultimaActividad = null;
      for (const { h } of entradasHistorial) {
        for (const raw of [h.assignedDate, h.completedDate]) {
          const d = parseSheetDate(raw);
          if (d && (!ultimaActividad || d > ultimaActividad)) ultimaActividad = d;
        }
      }

      const { page, meta } = paginar(coincidencias, offset, limit);

      const resumen = {
        consulta: publicador,
        nombresCoincidentes,
        territoriosActuales: actuales.length,
        vencidosActuales: actuales.filter((t) => t.isExpired).length,
        asignacionesEnRango,
        finalizacionesEnRango,
        diasMediosRetencion: diasMediosRetencion(enRango.map(({ h }) => h)),
        ultimaActividad: ultimaActividad ? formatISODate(ultimaActividad) : null
      };

      const output = {
        ...describirRango(rango),
        resumen,
        ...meta,
        coincidencias: page
      };

      // Si el nombre parcial resuelve a una sola persona, la citamos por su
      // nombre canónico: es lo que el agente debe repetir en la respuesta.
      const titulo = nombresCoincidentes.length === 1 ? nombresCoincidentes[0] : publicador;
      const lines = [`# ${titulo} — ${rango.etiqueta}`, ""];
      if (nombresCoincidentes.length > 1) {
        lines.push(`⚠️ El nombre coincide con ${nombresCoincidentes.length} publicadores: ${nombresCoincidentes.join(", ")}.`, "");
      }
      lines.push(
        `- **Territorios asignados ahora:** ${resumen.territoriosActuales}${resumen.vencidosActuales > 0 ? ` (${plural(resumen.vencidosActuales, "vencido", "vencidos")})` : ""}`,
        `- **En el periodo:** ${plural(resumen.asignacionesEnRango, "asignación", "asignaciones")}, ${plural(resumen.finalizacionesEnRango, "finalización", "finalizaciones")}`,
        ...(resumen.diasMediosRetencion !== null ? [`- **Días medios con un territorio:** ${resumen.diasMediosRetencion}`] : []),
        ...(resumen.ultimaActividad ? [`- **Última actividad:** ${resumen.ultimaActividad}`] : []),
        "",
        `## Territorios (${meta.total}, mostrando ${meta.count})`,
        ""
      );
      for (const m of page) {
        const marca = m.tipo === "historico" ? " (histórico)" : m.vencido ? ` ⚠️ vencido (${plural(m.diasVencido, "día", "días")})` : "";
        const fechas = m.fechaCompletado
          ? `asignado ${m.fechaAsignacion}, completado ${m.fechaCompletado}`
          : `asignado ${m.fechaAsignacion || "sin fecha"}`;
        lines.push(`- **Territorio ${m.id}** (${m.zona || "sin zona"}): ${fechas}${marca}`);
      }
      if (page.length === 0) {
        lines.push(nombresCoincidentes.length === 0
          ? `No hay ningún publicador que se llame "${publicador}". Usa publicadores_listar para ver los nombres registrados.`
          : `Sin territorios para "${publicador}" con esos filtros.`);
      }
      for (const aviso of output.avisos || []) lines.push("", `_${aviso}_`);

      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  const ActivityInputSchema = z.object({
    ...CAMPOS_FECHA,
    evento: z.enum(["asignados", "completados", "ambos"]).default("ambos")
      .describe("Qué contar: 'asignados' (territorios que se entregaron), 'completados' (que se trabajaron/devolvieron) o 'ambos'."),
    zona: z.string().optional().describe("Filtrar por zona (coincidencia parcial)"),
    publicador: z.string().optional().describe("Filtrar por publicador (coincidencia parcial)"),
    agrupar: z.enum(["ninguno", "mes", "zona", "publicador", "territorio"]).default("ninguno")
      .describe("Agrupa el resultado en vez de listar evento a evento. Con cualquier valor distinto de 'ninguno' NO se devuelve la lista de eventos, solo los totales por grupo."),
    ...CAMPOS_PAGINACION
  }).strict();

  server.registerTool(
    "territorios_actividad",
    {
      title: "Actividad de Territorios por Fechas",
      description: `Qué ha pasado con los territorios en un rango de fechas: qué se asignó y qué se completó (trabajó/devolvió).
Solo lectura.

Úsala para "¿qué territorios se trabajaron en junio?", "¿qué se ha devuelto la semana pasada?",
"¿cuántos territorios se asignaron en los últimos 6 meses?", "¿qué zona se ha movido más este año?".

IMPORTANTE sobre las fechas: NO calcules tú los rangos. Pasa 'periodo' (ej. 'semana_pasada',
'ultimos_6_meses') o 'mes' (ej. 'junio') y el servidor los resuelve; la respuesta incluye
"rangoResuelto" para que puedas decir exactamente qué fechas se han mirado.

Args:
  - periodo / mes / desde / hasta: el rango. Precedencia: desde/hasta > mes > periodo. Sin ninguno, todo el historial.
  - evento ('asignados'|'completados'|'ambos'): por defecto 'ambos'. "Trabajado", "devuelto" y "completado" son lo mismo en el Sheet.
  - zona, publicador (opcionales): filtros de coincidencia parcial.
  - agrupar ('ninguno'|'mes'|'zona'|'publicador'|'territorio'): agrega en vez de listar. Úsalo para preguntas de "cuántos" y para no gastar contexto con listas largas.
  - limit / offset: paginación de la lista o de los grupos.

Devuelve: rangoResuelto, totales (asignaciones, finalizaciones, territorios y publicadores distintos)
y, según 'agrupar', la lista de eventos o los grupos. Los ids y nombres que devuelve sirven tal cual
para territorios_buscar_por_id y territorios_buscar_por_publicador.`,
      inputSchema: ActivityInputSchema,
      annotations: ANNOTATIONS
    },
    async ({ periodo, mes, desde, hasta, evento, zona, publicador, agrupar, limit, offset }) => {
      const all = await getTerritories();
      const rango = resolveRango({ desde, hasta, mes, periodo });
      if (rango.error) return errorTool(rango.error);

      const tipos = evento === "asignados" ? ["asignacion"]
        : evento === "completados" ? ["finalizacion"]
          : ["asignacion", "finalizacion"];

      const { eventos, fechasNoReconocidas, fechasAmbiguas } = extraerEventos(all, {
        desde: rango.desde, hasta: rango.hasta, tipos, zona, publicador
      });

      const indice = indexarPublicadores(all);
      const totales = {
        asignaciones: eventos.filter((e) => e.tipo === "asignacion").length,
        finalizaciones: eventos.filter((e) => e.tipo === "finalizacion").length,
        territoriosDistintos: new Set(eventos.map((e) => e.id)).size,
        publicadoresDistintos: new Set(eventos.filter((e) => e.publicador).map((e) => nombreCanonico(indice, e.publicador))).size
      };

      const base = { ...describirRango(rango, fechasNoReconocidas, fechasAmbiguas), evento, agrupar, totales };

      if (agrupar === "ninguno") {
        const { page, meta } = paginar(eventos, offset, limit);
        const output = {
          ...base,
          ...meta,
          // Se omite fechaObj (el Date interno): fuera solo viaja la fecha ISO.
          eventos: page.map((e) => ({
            id: e.id,
            zona: e.zona,
            publicador: e.publicador ? nombreCanonico(indice, e.publicador) : null,
            tipo: e.tipo,
            fecha: e.fecha,
            enCurso: e.enCurso
          }))
        };

        const lines = [
          `# Actividad — ${rango.etiqueta}`, "",
          `${plural(totales.asignaciones, "asignación", "asignaciones")} y ${plural(totales.finalizaciones, "finalización", "finalizaciones")}, sobre ${plural(totales.territoriosDistintos, "territorio", "territorios")}.`,
          ""
        ];
        for (const e of output.eventos) {
          const verbo = e.tipo === "asignacion" ? "asignado a" : "completado por";
          lines.push(`- ${e.fecha} — **Territorio ${e.id}** (${e.zona || "sin zona"}): ${verbo} ${e.publicador || "?"}${e.enCurso ? " _(sigue asignado)_" : ""}`);
        }
        if (output.eventos.length === 0) lines.push("Ningún movimiento en ese rango con esos filtros.");
        for (const aviso of output.avisos || []) lines.push("", `_${aviso}_`);

        return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
      }

      const grupos = new Map();
      for (const e of eventos) {
        let clave;
        let etiqueta;
        if (agrupar === "mes") {
          clave = e.fecha.slice(0, 7);
          etiqueta = clave;
        } else if (agrupar === "zona") {
          clave = e.zona || "Sin zona";
          etiqueta = clave;
        } else if (agrupar === "publicador") {
          clave = e.publicador ? nombreCanonico(indice, e.publicador) : "Sin publicador";
          etiqueta = clave;
        } else {
          clave = e.id;
          etiqueta = `Territorio ${e.id}`;
        }

        if (!grupos.has(clave)) {
          grupos.set(clave, { clave, etiqueta, asignaciones: 0, finalizaciones: 0, _territorios: new Set() });
        }
        const g = grupos.get(clave);
        if (e.tipo === "asignacion") g.asignaciones++; else g.finalizaciones++;
        g._territorios.add(e.id);
      }

      const lista = [...grupos.values()]
        .map(({ _territorios, ...g }) => ({ ...g, territorios: _territorios.size }))
        .sort((a, b) => agrupar === "mes"
          ? b.clave.localeCompare(a.clave)
          : (b.asignaciones + b.finalizaciones) - (a.asignaciones + a.finalizaciones) || String(a.clave).localeCompare(String(b.clave)));

      const { page, meta } = paginar(lista, offset, limit);
      const output = { ...base, ...meta, grupos: page };

      const lines = [
        `# Actividad por ${agrupar} — ${rango.etiqueta}`, "",
        `${plural(totales.asignaciones, "asignación", "asignaciones")} y ${plural(totales.finalizaciones, "finalización", "finalizaciones")}, sobre ${plural(totales.territoriosDistintos, "territorio", "territorios")}.`,
        ""
      ];
      for (const g of page) {
        lines.push(`- **${g.etiqueta}**: ${plural(g.asignaciones, "asignación", "asignaciones")}, ${plural(g.finalizaciones, "finalización", "finalizaciones")} (${plural(g.territorios, "territorio", "territorios")})`);
      }
      if (page.length === 0) lines.push("Ningún movimiento en ese rango con esos filtros.");
      for (const aviso of output.avisos || []) lines.push("", `_${aviso}_`);

      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  const PublishersInputSchema = z.object({
    buscar: z.string().optional().describe("Filtra por nombre (coincidencia parcial, sin acentos ni mayúsculas)"),
    soloConTerritorios: z.boolean().default(false)
      .describe("true = solo publicadores que tienen algún territorio asignado ahora mismo"),
    ordenar: z.enum(["actuales", "finalizaciones", "asignaciones", "nombre", "ultima_actividad"]).default("actuales")
      .describe("Criterio de orden. 'actuales' = quién tiene más territorios ahora; 'ultima_actividad' = del más reciente al más antiguo."),
    ...CAMPOS_FECHA,
    ...CAMPOS_PAGINACION
  }).strict();

  server.registerTool(
    "publicadores_listar",
    {
      title: "Listar Publicadores",
      description: `Lista los publicadores que aparecen en el historial, con cuántos territorios tienen ahora y cuánta actividad han tenido.
Solo lectura.

Úsala para "¿quién tiene territorios asignados?", "¿quién tiene más?", "¿quién lleva meses sin
trabajar ninguno?", y para resolver un nombre a medias antes de llamar a
territorios_buscar_por_publicador (los nombres del Sheet están escritos a mano y se agrupan aquí
por su forma normalizada).

Args:
  - buscar (string, opcional): filtro por nombre.
  - soloConTerritorios (boolean): solo los que tienen algo asignado ahora. Por defecto false.
  - ordenar: 'actuales' (por defecto) | 'finalizaciones' | 'asignaciones' | 'nombre' | 'ultima_actividad'.
  - periodo / mes / desde / hasta: acotan los contadores de actividad (no los territorios actuales).
  - limit / offset: paginación.

Devuelve por publicador: nombre canónico, variantes de escritura encontradas, territorios asignados
ahora (con sus ids), cuántos están vencidos, asignaciones y finalizaciones del periodo y fecha de la
última actividad.`,
      inputSchema: PublishersInputSchema,
      annotations: ANNOTATIONS
    },
    async ({ buscar, soloConTerritorios, ordenar, periodo, mes, desde, hasta, limit, offset }) => {
      const all = await getTerritories();
      const rango = resolveRango({ desde, hasta, mes, periodo });
      if (rango.error) return errorTool(rango.error);

      const indice = indexarPublicadores(all);
      const stats = new Map();
      const registrar = (clave) => {
        if (!stats.has(clave)) {
          const info = indice.get(clave);
          stats.set(clave, {
            nombre: info?.nombre || clave,
            variantes: info?.variantes || [],
            territoriosActuales: 0,
            idsActuales: [],
            vencidosActuales: 0,
            asignacionesEnRango: 0,
            finalizacionesEnRango: 0,
            _ultima: null
          });
        }
        return stats.get(clave);
      };

      for (const [clave] of indice) registrar(clave);

      for (const t of all) {
        if (t.status === "assigned" && t.publisher) {
          const s = registrar(normalizeText(t.publisher));
          s.territoriosActuales++;
          s.idsActuales.push(t.id);
          if (t.isExpired) s.vencidosActuales++;
        }
        for (const h of t.history) {
          if (!h.publisher) continue;
          const s = registrar(normalizeText(h.publisher));
          const a = parseSheetDate(h.assignedDate);
          const c = parseSheetDate(h.completedDate);
          if (a && isWithinRange(a, rango.desde, rango.hasta)) s.asignacionesEnRango++;
          if (c && isWithinRange(c, rango.desde, rango.hasta)) s.finalizacionesEnRango++;
          for (const d of [a, c]) if (d && (!s._ultima || d > s._ultima)) s._ultima = d;
        }
      }

      let lista = [...stats.values()]
        .map(({ _ultima, ...s }) => ({ ...s, ultimaActividad: _ultima ? formatISODate(_ultima) : null }))
        .filter((s) => (!buscar || coincideTexto(s.nombre, buscar)) && (!soloConTerritorios || s.territoriosActuales > 0));

      lista.sort((a, b) => {
        switch (ordenar) {
          case "nombre": return a.nombre.localeCompare(b.nombre);
          case "finalizaciones": return b.finalizacionesEnRango - a.finalizacionesEnRango || a.nombre.localeCompare(b.nombre);
          case "asignaciones": return b.asignacionesEnRango - a.asignacionesEnRango || a.nombre.localeCompare(b.nombre);
          case "ultima_actividad": return String(b.ultimaActividad || "").localeCompare(String(a.ultimaActividad || ""));
          default: return b.territoriosActuales - a.territoriosActuales || a.nombre.localeCompare(b.nombre);
        }
      });

      const { page, meta } = paginar(lista, offset, limit);
      const output = {
        ...describirRango(rango),
        ...meta,
        publicadores: page.map((p) => ({ ...p, variantes: p.variantes.length > 1 ? p.variantes : undefined }))
      };

      const lines = [`# Publicadores (${meta.total}, mostrando ${meta.count}) — actividad de ${rango.etiqueta}`, ""];
      for (const p of page) {
        const actuales = p.territoriosActuales > 0
          ? `${plural(p.territoriosActuales, "territorio", "territorios")} [${p.idsActuales.join(", ")}]${p.vencidosActuales > 0 ? ` ⚠️ ${plural(p.vencidosActuales, "vencido", "vencidos")}` : ""}`
          : "sin territorios asignados";
        const actividad = `${plural(p.asignacionesEnRango, "asignación", "asignaciones")}, ${plural(p.finalizacionesEnRango, "finalización", "finalizaciones")}`;
        lines.push(`- **${p.nombre}**: ${actuales} · ${actividad}${p.ultimaActividad ? ` · última actividad ${p.ultimaActividad}` : ""}`);
      }
      if (page.length === 0) lines.push("Ningún publicador con esos filtros.");

      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );

  const StaleInputSchema = z.object({
    zona: z.string().optional().describe("Filtrar por zona (coincidencia parcial)"),
    mesesMinimos: z.number().min(0).max(120).default(0)
      .describe("Solo territorios que llevan al menos estos meses sin completarse. 0 = todos, ordenados de más a menos tiempo."),
    incluirNuncaCompletados: z.boolean().default(true)
      .describe("Incluir los territorios sin ninguna fecha de finalización registrada (aparecen los primeros)."),
    ...CAMPOS_PAGINACION
  }).strict();

  server.registerTool(
    "territorios_sin_trabajar",
    {
      title: "Territorios Sin Trabajar",
      description: `Territorios ordenados por el tiempo que llevan sin completarse, del más olvidado al más reciente.
Solo lectura.

OJO, no confundir con territorios_vencidos: "vencido" mira la asignación actual (alguien lo tiene
desde hace más de 4 meses); "sin trabajar" mira la última vez que se completó, esté libre o asignado.
Un territorio libre que nadie coge desde hace dos años no está vencido, pero sí sin trabajar.

Args:
  - zona (string, opcional): filtro por zona.
  - mesesMinimos (number): umbral en meses. 0 = todos.
  - incluirNuncaCompletados (boolean): por defecto true.
  - limit / offset: paginación.

Devuelve por territorio: id, zona, estado, publicador actual si lo tiene, última finalización y
días/meses transcurridos.`,
      inputSchema: StaleInputSchema,
      annotations: ANNOTATIONS
    },
    async ({ zona, mesesMinimos, incluirNuncaCompletados, limit, offset }) => {
      const all = await getTerritories();
      const ahora = new Date();
      const umbralDias = mesesMinimos * 30.44;

      let items = all
        .filter((t) => !zona || coincideTexto(t.zone, zona))
        .map((t) => {
          const ultima = ultimaFinalizacion(t);
          const dias = ultima ? daysBetween(ultima, ahora) : null;
          return {
            id: t.id,
            zona: t.zone || null,
            estado: t.status === "free" ? "libre" : "asignado",
            publicador: t.status === "assigned" ? (t.publisher || null) : null,
            ultimaFinalizacion: ultima ? formatISODate(ultima) : null,
            diasSinCompletar: dias,
            mesesSinCompletar: dias === null ? null : Math.round((dias / 30.44) * 10) / 10
          };
        })
        .filter((t) => (t.diasSinCompletar === null ? incluirNuncaCompletados : t.diasSinCompletar >= umbralDias));

      // Sin fecha registrada = lo más antiguo posible: va primero.
      items.sort((a, b) => {
        if (a.diasSinCompletar === null && b.diasSinCompletar === null) return String(a.id).localeCompare(String(b.id));
        if (a.diasSinCompletar === null) return -1;
        if (b.diasSinCompletar === null) return 1;
        return b.diasSinCompletar - a.diasSinCompletar;
      });

      const { page, meta } = paginar(items, offset, limit);
      const output = { criterio: mesesMinimos > 0 ? `al menos ${mesesMinimos} meses sin completarse` : "todos, del más antiguo al más reciente", ...meta, territorios: page };

      const lines = [`# Territorios sin trabajar (${meta.total}, mostrando ${meta.count})`, ""];
      for (const t of page) {
        const antiguedad = t.diasSinCompletar === null
          ? "sin ninguna finalización registrada"
          : `última finalización ${formatSheetDate(parseSheetDate(t.ultimaFinalizacion))} (${plural(t.mesesSinCompletar, "mes", "meses")})`;
        lines.push(`- **Territorio ${t.id}** (${t.zona || "sin zona"}, ${t.estado}): ${antiguedad}`);
      }
      if (page.length === 0) lines.push("Ningún territorio con esos filtros.");

      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );
}

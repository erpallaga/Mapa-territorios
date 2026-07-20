import { z } from "zod";
import { getTerritories } from "./data.js";

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
        publicador: t.status === "assigned" ? (t.publisher || null) : null,
        fechaAsignacion: t.status === "assigned" ? (t.assignedDate || null) : null,
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
        publicador: t.status === "assigned" ? (t.publisher || null) : null,
        fechaAsignacion: t.status === "assigned" ? (t.assignedDate || null) : null,
        ultimaFechaCompletado: t.lastCompletedDate || null,
        finalizacionesUltimos12Meses: t.completionCount12m,
        vencido: t.isExpired,
        diasVencido: t.isExpired ? t.expiredDays : null,
        historial: t.history
      };

      const lines = [`# Territorio ${t.id} (${t.zone || "sin zona"})`, "", `**Estado:** ${output.estado}`];
      if (output.publicador) lines.push(`**Publicador actual:** ${output.publicador} (asignado ${output.fechaAsignacion})`);
      if (output.vencido) lines.push(`⚠️ **Vencido** hace ${output.diasVencido} días`);
      lines.push("", "## Historial", "");
      if (t.history.length === 0) {
        lines.push("Sin historial registrado.");
      } else {
        for (const h of t.history) {
          lines.push(`- ${h.publisher}: asignado ${h.assignedDate}${h.completedDate ? `, completado ${h.completedDate}` : " (en curso)"}`);
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

      let expired = all.filter((t) => t.isExpired);
      if (zona) {
        const zonaLower = zona.toLowerCase();
        expired = expired.filter((t) => (t.zone || "").toLowerCase().includes(zonaLower));
      }
      expired.sort((a, b) => b.expiredDays - a.expiredDays);

      const total = expired.length;
      const page = expired.slice(offset, offset + limit);
      const items = page.map((t) => ({
        id: t.id, zona: t.zone, publicador: t.publisher || null,
        fechaAsignacion: t.assignedDate || null, diasVencido: t.expiredDays
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
    publicador: z.string().min(1).describe("Nombre (o parte del nombre) del publicador a buscar, sin distinguir mayúsculas"),
    soloActuales: z.boolean().default(true)
      .describe("Si es true (por defecto), solo territorios actualmente asignados a este publicador. Si es false, incluye también coincidencias en el historial de asignaciones pasadas."),
    limit: z.number().int().min(1).max(100).default(50).describe("Máximo de resultados a devolver (1-100)"),
    offset: z.number().int().min(0).default(0).describe("Número de resultados a saltar, para paginación")
  }).strict();

  server.registerTool(
    "territorios_buscar_por_publicador",
    {
      title: "Buscar Territorios por Publicador",
      description: `Busca territorios asociados a un publicador por nombre, sin necesidad de acotar por zona.
Solo lectura.

Args:
  - publicador (string): nombre o parte del nombre del publicador (coincidencia parcial, sin distinguir mayúsculas).
  - soloActuales (boolean): si true (por defecto, recomendado para preguntas del tipo "¿qué territorios tiene X ahora?"), solo territorios cuyo estado sigue siendo "asignado" a ese publicador. Si false, también incluye coincidencias en el historial de asignaciones ya completadas (territorios que pueden estar libres de nuevo).
  - limit (number): máximo de resultados (1-100, por defecto 50).
  - offset (number): resultados a saltar para paginación.

Devuelve por cada coincidencia: id de territorio, zona, si es asignación actual o histórica,
fecha de asignación (y de finalización si es histórica), y si está vencido (solo para asignaciones actuales).`,
      inputSchema: PublisherInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ publicador, soloActuales, limit, offset }) => {
      const all = await getTerritories();
      const needle = publicador.toLowerCase();
      const matches = [];

      for (const t of all) {
        if (soloActuales) {
          // Importante: el campo "publisher" conserva el último nombre del
          // historial aunque el territorio ya se haya liberado, así que
          // "actual" exige también que el estado siga siendo "assigned".
          if (t.status === "assigned" && t.publisher && t.publisher.toLowerCase().includes(needle)) {
            matches.push({
              id: t.id,
              zona: t.zone,
              estado: "asignado",
              publicador: t.publisher,
              fechaAsignacion: t.assignedDate || null,
              vencido: t.isExpired,
              diasVencido: t.isExpired ? t.expiredDays : null,
              tipo: "actual"
            });
          }
        } else {
          t.history.forEach((h, idx) => {
            if (h.publisher && h.publisher.toLowerCase().includes(needle)) {
              matches.push({
                id: t.id,
                zona: t.zone,
                publicador: h.publisher,
                fechaAsignacion: h.assignedDate || null,
                fechaCompletado: h.completedDate || null,
                tipo: idx === 0 && t.status === "assigned" ? "actual" : "historico"
              });
            }
          });
        }
      }

      const total = matches.length;
      const page = matches.slice(offset, offset + limit);

      const output = {
        total,
        count: page.length,
        offset,
        coincidencias: page,
        has_more: total > offset + page.length,
        ...(total > offset + page.length ? { next_offset: offset + page.length } : {})
      };

      const lines = [`# Territorios de "${publicador}" (${total} encontrados, mostrando ${page.length})`, ""];
      for (const m of page) {
        const marca = m.tipo === "historico" ? " (histórico)" : m.vencido ? ` ⚠️ vencido (${m.diasVencido} días)` : "";
        const fechas = m.fechaCompletado
          ? `asignado ${m.fechaAsignacion}, completado ${m.fechaCompletado}`
          : `asignado ${m.fechaAsignacion}`;
        lines.push(`- **Territorio ${m.id}** (${m.zona || "sin zona"}): ${fechas}${marca}`);
      }
      if (page.length === 0) lines.push(`Ningún territorio encontrado para "${publicador}".`);

      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    }
  );
}

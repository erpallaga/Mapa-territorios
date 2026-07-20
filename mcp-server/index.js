#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getTerritories } from "./data.js";

const server = new McpServer({
  name: "territorios-mcp-server",
  version: "1.0.0"
});

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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
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
      publicador: t.publisher || null,
      fechaAsignacion: t.assignedDate || null,
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

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: output
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Servidor MCP de territorios corriendo (stdio)");
}

main().catch((error) => {
  console.error("Error al arrancar el servidor:", error);
  process.exit(1);
});
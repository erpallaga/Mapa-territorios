# territorios-mcp-server

Servidor MCP (Model Context Protocol) de solo lectura para consultar el estado de los territorios y zonas en lenguaje natural, reutilizando `fetchTerritoryData` de `src/lib/sheets.js`.

## Archivos

- `data.js` — trae y cachea (60s) los datos del Sheet.
- `tools.js` — define las 4 tools (`registerTerritorioTools(server)`), compartidas entre el entry point local (`index.js`, stdio) y el endpoint remoto en Vercel (`api/mcp.js`, HTTP).
- `index.js` — entry point local, transporte stdio.

## Instalación

```bash
cd mcp-server
npm install
```

## Registro en Claude Code

```bash
claude mcp add territorios-mcp -- node "<ruta-absoluta>/mcp-server/index.js"
```

Sustituye `<ruta-absoluta>` por la ruta completa al repo, por ejemplo:

```bash
claude mcp add territorios-mcp -- node "C:/Users/Manuel/Documents/GitHub/Mapa-territorios/mcp-server/index.js"
```

## Registro en Claude Desktop

Añade esta entrada a `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "territorios-mcp": {
      "command": "node",
      "args": ["<ruta-absoluta>/mcp-server/index.js"]
    }
  }
}
```

## Probar con MCP Inspector

```bash
npx @modelcontextprotocol/inspector node mcp-server/index.js
```

## Versión remota (Vercel)

El mismo conjunto de tools se expone también por HTTP en `api/mcp.js`, para que la Edge
Function `supabase/functions/ask-territorios` (y cualquier otro cliente MCP remoto) pueda
usarlo. Ver el `README.md` de la raíz del proyecto para las variables de entorno necesarias
(`MCP_SHARED_SECRET`, `ANTHROPIC_API_KEY`, etc.).

## Tools disponibles

| Tool | Descripción |
|---|---|
| `territorios_listar` | Lista territorios con estado (libre/asignado), zona y datos de asignación, con filtros por estado/zona y paginación. |
| `territorios_buscar_por_id` | Devuelve el detalle completo de un territorio, incluyendo su historial de asignaciones. |
| `territorios_vencidos` | Lista los territorios asignados desde hace más de 4 meses, ordenados por días de retraso. |
| `territorios_estadisticas` | Resumen estadístico global (total, libres, asignados, vencidos) y desglose por zona. |

## Notas técnicas

- Transporte local: **stdio**. Transporte remoto (`api/mcp.js`): **Streamable HTTP**, protegido con token compartido.
- Los datos se leen del Google Sheet publicado como CSV y se cachean en memoria durante **60 segundos** para reducir peticiones.
- Todas las tools son de solo lectura (no modifican el Sheet).

# territorios-mcp-server

Servidor MCP (Model Context Protocol) de solo lectura para consultar el estado de los territorios y zonas en lenguaje natural, reutilizando `fetchTerritoryData` de `src/lib/sheets.js`.

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

## Tools disponibles

| Tool | Descripción |
|---|---|
| `territorios_listar` | Lista territorios con estado (libre/asignado), zona y datos de asignación, con filtros por estado/zona y paginación. |
| `territorios_buscar_por_id` | Devuelve el detalle completo de un territorio, incluyendo su historial de asignaciones. |
| `territorios_vencidos` | Lista los territorios asignados desde hace más de 4 meses, ordenados por días de retraso. |
| `territorios_estadisticas` | Resumen estadístico global (total, libres, asignados, vencidos) y desglose por zona. |

## Notas técnicas

- Transporte: **stdio**.
- Los datos se leen del Google Sheet publicado como CSV y se cachean en memoria durante **60 segundos** para reducir peticiones.
- Todas las tools son de solo lectura (no modifican el Sheet).

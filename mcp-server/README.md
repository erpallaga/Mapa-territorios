# Territorios MCP Server

Servidor MCP (Model Context Protocol) de **solo lectura** para consultar en lenguaje natural
el estado de los territorios: libres/asignados, vencidos (asignados hace más de 4 meses) y
estadísticas por zona.

Reutiliza la misma fuente de datos que la app web (`src/lib/sheets.js`), leyendo el Google
Sheet publicado como CSV. No modifica nada — no hay ninguna tool de escritura.

Las dependencias (`@modelcontextprotocol/sdk`, `zod`) viven en el `package.json` de la raíz
del repo, no en uno propio de esta carpeta — así el mismo código de tools lo usan tanto el
entry point local (`index.js`, stdio) como el endpoint remoto en Vercel (`api/mcp.js`, HTTP).

## Archivos

- `data.js` — trae y cachea (60s) los datos del Sheet, reutilizando `fetchTerritoryData`.
- `tools.js` — define las 4 tools (`registerTerritorioTools(server)`), compartidas entre stdio y HTTP.
- `index.js` — entry point local, transporte stdio.

## Uso local (Claude Code / Claude Desktop)

Desde la raíz del repo:

```bash
npm install
```

### Registrar en Claude Code

```bash
claude mcp add territorios-mcp -- node "<ruta-absoluta-al-repo>/mcp-server/index.js"
```

### Registrar en Claude Desktop (alternativa)

Añadir en `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "territorios-mcp": {
      "command": "node",
      "args": ["<ruta-absoluta-al-repo>/mcp-server/index.js"]
    }
  }
}
```

## Probar con MCP Inspector

```bash
npx @modelcontextprotocol/inspector node mcp-server/index.js
```

## Versión remota (Vercel)

El mismo conjunto de tools se expone también por HTTP en `api/mcp.js`, para que la
Edge Function `supabase/functions/ask-territorios` (y cualquier otro cliente MCP remoto)
pueda usarlo. Ver la raíz del `README.md` del proyecto para las variables de entorno
necesarias (`MCP_SHARED_SECRET`, etc.).

## Tools disponibles

- `territorios_listar` — lista territorios, filtrando por estado/zona, con paginación.
- `territorios_buscar_por_id` — detalle completo + historial de un territorio.
- `territorios_vencidos` — territorios asignados hace más de 4 meses, ordenados por retraso.
- `territorios_estadisticas` — resumen global y por zona.

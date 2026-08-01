# territorios-mcp-server

Servidor MCP (Model Context Protocol) de solo lectura para consultar el estado de los territorios y zonas en lenguaje natural, reutilizando `fetchTerritoryData` de `src/lib/sheets.js`.

## Archivos

- `data.js` — trae y cachea (60s) los datos del Sheet. Acepta `TERRITORIOS_SHEET_URL` para apuntar a otro CSV (lo usan los tests).
- `tools.js` — define las 8 tools (`registerTerritorioTools(server)`), compartidas entre el entry point local (`index.js`, stdio) y el endpoint remoto en Vercel (`api/mcp.js`, HTTP).
- `query.js` — helpers de consulta: extracción de eventos del historial, índice de publicadores, paginación y normalización de fechas de salida.
- `index.js` — entry point local, transporte stdio.

La interpretación de fechas vive en `src/lib/dates.js`, compartida con la web app.

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
| `territorios_buscar_por_publicador` | Todo lo de un publicador: qué tiene asignado ahora, qué ha trabajado en un periodo, días medios de retención y última actividad. |
| `territorios_actividad` | Qué se asignó y qué se completó (trabajó/devolvió) en un rango de fechas. Filtra por zona y publicador, y agrupa por mes, zona, publicador o territorio. |
| `publicadores_listar` | Publicadores del historial con sus territorios actuales y su actividad. Resuelve nombres a medias y agrupa las variantes de escritura. |
| `territorios_sin_trabajar` | Territorios ordenados por el tiempo que llevan sin completarse, estén libres o asignados. |

## Fechas y rangos

Los rangos **se resuelven en el servidor**, no en el modelo: el agente no sabe qué día es hoy, así
que pedirle que calcule "la semana pasada" es pedirle que se lo invente. Las tools con fechas
aceptan:

- `periodo`: `hoy`, `ayer`, `esta_semana`, `semana_pasada`, `ultimos_7_dias`, `este_mes`,
  `mes_pasado`, `ultimos_30_dias`, `ultimos_3_meses`, `ultimos_6_meses`, `ultimo_ano`, `este_ano`,
  `ano_pasado`.
- `mes`: `'2026-06'` o el nombre (`'junio'`, `'junio 2026'`). Sin año, la última vez que ocurrió.
- `desde` / `hasta`: `YYYY-MM-DD`.

Precedencia: `desde`/`hasta` > `mes` > `periodo`. La respuesta siempre incluye `rangoResuelto`
(y un `avisos` si se ha ignorado algún parámetro o si había fechas ilegibles en el Sheet).

Como el Sheet se rellena a mano, `src/lib/dates.js` acepta las variantes que aparecen en la
práctica (`3/6/2026`, `03-06-26`, `2026-06-03`, `3 de junio de 2026`, `03062026`, números de serie
de hoja de cálculo) y recupera las fechas escritas al revés (`6/25/2026`) marcándolas como
ambiguas. Lo que no encaja no se adivina: se cuenta y se reporta en `avisos`.

## Tests

Desde la raíz del repo:

```bash
npm test
```

Cubre el parseo de fechas (`src/lib/dates.test.js`) y las tools contra un CSV de ejemplo con datos
sucios a propósito (`mcp-server/tools.test.js`), sin tocar la red ni el Sheet real.

Para comprobar el parser contra los datos **reales**:

```bash
npm run auditar-fechas
```

Recorre todas las celdas de fecha de la Sheet publicada y dice cuáles no entiende (con el
territorio y la columna donde están) y cuáles ha recuperado por tener el día y el mes invertidos.

## Notas técnicas

- Transporte local: **stdio**. Transporte remoto (`api/mcp.js`): **Streamable HTTP**, protegido con token compartido.
- Los datos se leen del Google Sheet publicado como CSV y se cachean en memoria durante **60 segundos** para reducir peticiones.
- Todas las tools son de solo lectura (no modifican el Sheet).
- Los nombres de publicador se normalizan (sin acentos ni mayúsculas) para agrupar las variantes de escritura, y se cita siempre la grafía más frecuente.

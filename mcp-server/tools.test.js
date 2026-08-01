// Tests de las tools del MCP contra un CSV de ejemplo: `node --test` (npm test).
//
// El CSV está escrito a propósito con las guarradas que aparecen en un Sheet
// rellenado a mano: la misma persona con y sin acento, fechas en formato
// americano, un número de serie de hoja de cálculo, texto donde debería haber
// una fecha y un territorio sin historial.
//
// No se usa el SDK de MCP: `registerTerritorioTools` solo necesita un objeto con
// `registerTool`, así que los handlers se invocan directamente. Los tests no
// dependen del día en que se ejecuten (nada de asserts sobre "vencido" o sobre
// periodos relativos, que se mueven con el reloj).

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const CSV = `Núm. de terr.,Zona,Viviendas,Estado,Última fecha,Publicador,Asignado,Completado,Publicador,Asignado,Completado
1,Sants,50,ASIGNADO,15/03/2026,Ana López,10/01/2026,15/03/2026,Ana Lopez,20/06/2026,
2,Sarrià,40,LIBRE,3 de julio de 2026,Raquel Vidal,05/05/2026,3 de julio de 2026,Raquel Vidal,pendiente,
3,Pedralbes,30,ASIGNADO,12/12/2025,Eric P.,2025-12-01,12/12/2025,Eric P.,01/02/2026,
4,Sants,20,LIBRE,,,,,,,
5,Sarrià,25,LIBRE,45810,Núria Solé,01/04/2025,45810,,,
6,Sants,10,ASIGNADO,30/06/2026,Ana López,01/06/2026,30/06/2026,Raquel Vidal,6/25/2026,
`;

// Servidor local que hace de Sheet publicado, para no tocar la red de verdad.
const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/csv' });
    res.end(CSV);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.TERRITORIOS_SHEET_URL = `http://127.0.0.1:${server.address().port}/data.csv`;
process.env.NO_PROXY = '127.0.0.1,localhost';
test.after(() => server.close());

const { registerTerritorioTools } = await import('./tools.js');

const tools = new Map();
registerTerritorioTools({
    registerTool(name, config, handler) {
        tools.set(name, { config, handler });
    },
});

/** Llama a una tool pasando los argumentos por su schema, para que se apliquen los defaults. */
async function call(name, args = {}) {
    const tool = tools.get(name);
    assert.ok(tool, `la tool ${name} no está registrada`);
    const res = await tool.handler(tool.config.inputSchema.parse(args));
    return { ...res, texto: res.content.map((c) => c.text).join('\n'), datos: res.structuredContent };
}

test('todas las tools están registradas y son de solo lectura', () => {
    assert.deepEqual([...tools.keys()].sort(), [
        'publicadores_listar',
        'territorios_actividad',
        'territorios_buscar_por_id',
        'territorios_buscar_por_publicador',
        'territorios_estadisticas',
        'territorios_listar',
        'territorios_sin_trabajar',
        'territorios_vencidos',
    ]);

    for (const [name, { config }] of tools) {
        assert.equal(config.annotations.readOnlyHint, true, `${name} debe estar anotada como solo lectura`);
        assert.equal(config.annotations.destructiveHint, false, `${name} no debe ser destructiva`);
    }
});

test('actividad: acota los eventos a un mes concreto', async () => {
    const { datos, texto } = await call('territorios_actividad', { mes: '2026-06' });

    assert.deepEqual(datos.rangoResuelto, { desde: '2026-06-01', hasta: '2026-06-30', etiqueta: 'junio de 2026' });
    // Territorio 6: asignado 01/06 y completado 30/06; territorio 1: asignado 20/06;
    // territorio 6 otra vez: asignado 25/06 (escrito como 6/25/2026).
    assert.equal(datos.totales.asignaciones, 3);
    assert.equal(datos.totales.finalizaciones, 1);
    assert.equal(datos.totales.territoriosDistintos, 2);
    assert.deepEqual([...new Set(datos.eventos.map((e) => e.id))].sort(), ['1', '6']);
    assert.match(texto, /día y el mes invertidos/, 'debe avisar de la fecha en formato americano');
});

test('actividad: separa asignaciones de finalizaciones', async () => {
    const soloCompletados = await call('territorios_actividad', { desde: '2026-01-01', hasta: '2026-12-31', evento: 'completados' });
    assert.equal(soloCompletados.datos.totales.asignaciones, 0);
    assert.ok(soloCompletados.datos.eventos.every((e) => e.tipo === 'finalizacion'));

    const soloAsignados = await call('territorios_actividad', { desde: '2026-01-01', hasta: '2026-12-31', evento: 'asignados' });
    assert.equal(soloAsignados.datos.totales.finalizaciones, 0);
});

test('actividad: agrupar no devuelve la lista de eventos', async () => {
    const { datos } = await call('territorios_actividad', { desde: '2025-01-01', hasta: '2026-12-31', agrupar: 'publicador' });

    assert.equal(datos.eventos, undefined, 'agrupado no debe gastar contexto listando eventos');
    const ana = datos.grupos.find((g) => g.clave === 'Ana López');
    assert.ok(ana, 'los nombres del grupo deben ser los canónicos');
    // 10/01/2026 y 20/06/2026 en el territorio 1, más 01/06/2026 en el 6.
    assert.equal(ana.asignaciones, 3);
    assert.equal(ana.finalizaciones, 2);
    assert.equal(ana.territorios, 2);
});

test('actividad: agrupar por mes ordena de más reciente a más antiguo', async () => {
    const { datos } = await call('territorios_actividad', { desde: '2026-01-01', hasta: '2026-12-31', evento: 'completados', agrupar: 'mes' });
    assert.deepEqual(datos.grupos.map((g) => g.clave), ['2026-07', '2026-06', '2026-03']);
});

test('actividad: filtros de zona y publicador', async () => {
    const { datos } = await call('territorios_actividad', { desde: '2025-01-01', hasta: '2026-12-31', zona: 'sarria', publicador: 'nuria' });
    // Coincidencia sin acentos por los dos lados: "sarria" -> Sarrià, "nuria" -> Núria Solé.
    assert.deepEqual([...new Set(datos.eventos.map((e) => e.id))], ['5']);
});

test('actividad: una fecha ilegible se reporta, no se cuela', async () => {
    const { datos } = await call('territorios_actividad', { desde: '2020-01-01', hasta: '2030-12-31' });
    assert.ok(datos.avisos.some((a) => a.includes('no se han podido interpretar')));
});

test('actividad: rango inválido devuelve error explicativo', async () => {
    const malo = await call('territorios_actividad', { desde: 'el martes' });
    assert.equal(malo.isError, true);
    assert.match(malo.texto, /No se entiende la fecha "desde"/);

    const alReves = await call('territorios_actividad', { desde: '2026-06-20', hasta: '2026-06-10' });
    assert.equal(alReves.isError, true);
});

test('publicador: sin fechas devuelve solo lo que tiene asignado ahora', async () => {
    const { datos } = await call('territorios_buscar_por_publicador', { publicador: 'ana' });

    assert.deepEqual(datos.resumen.nombresCoincidentes, ['Ana López']);
    assert.equal(datos.resumen.territoriosActuales, 1);
    assert.deepEqual(datos.coincidencias.map((c) => c.id), ['1']);
    assert.ok(datos.coincidencias.every((c) => c.tipo === 'actual'));
});

test('publicador: con fechas entra en el historial sin pedirlo', async () => {
    const { datos } = await call('territorios_buscar_por_publicador', { publicador: 'raquel', desde: '2026-01-01', hasta: '2026-12-31' });

    assert.deepEqual(datos.coincidencias.map((c) => c.id).sort(), ['2', '6']);
    assert.ok(datos.coincidencias.some((c) => c.tipo === 'historico'), 'debe incluir territorios ya devueltos');
    assert.equal(datos.resumen.finalizacionesEnRango, 1);
});

test('publicador: soloActuales explícito manda sobre el ajuste automático', async () => {
    const { datos } = await call('territorios_buscar_por_publicador', { publicador: 'raquel', desde: '2026-01-01', hasta: '2026-12-31', soloActuales: true });
    assert.ok(datos.coincidencias.every((c) => c.tipo === 'actual'));
});

test('publicador: calcula los días medios de retención', async () => {
    const { datos } = await call('territorios_buscar_por_publicador', { publicador: 'nuria', soloActuales: false });
    // 01/04/2025 -> 02/06/2025 (el 45810 del Sheet) = 62 días.
    assert.equal(datos.resumen.diasMediosRetencion, 62);
    assert.equal(datos.resumen.ultimaActividad, '2025-06-02');
});

test('publicador: un nombre que no existe lo dice y sugiere cómo seguir', async () => {
    const { datos, texto } = await call('territorios_buscar_por_publicador', { publicador: 'nadie' });
    assert.deepEqual(datos.resumen.nombresCoincidentes, []);
    assert.match(texto, /publicadores_listar/);
});

test('publicadores_listar agrupa las variantes de escritura de un nombre', async () => {
    const { datos } = await call('publicadores_listar', {});

    assert.equal(datos.total, 4, 'Ana López y "Ana Lopez" son la misma persona');
    const ana = datos.publicadores.find((p) => p.nombre === 'Ana López');
    assert.deepEqual(ana.variantes.sort(), ['Ana López', 'Ana Lopez'].sort());
    assert.deepEqual(ana.idsActuales, ['1']);
});

test('publicadores_listar: filtros y orden', async () => {
    const conTerritorios = await call('publicadores_listar', { soloConTerritorios: true });
    assert.deepEqual(conTerritorios.datos.publicadores.map((p) => p.nombre).sort(), ['Ana López', 'Eric P.', 'Raquel Vidal']);

    const buscando = await call('publicadores_listar', { buscar: 'sole' });
    assert.deepEqual(buscando.datos.publicadores.map((p) => p.nombre), ['Núria Solé']);

    const porNombre = await call('publicadores_listar', { ordenar: 'nombre' });
    const nombres = porNombre.datos.publicadores.map((p) => p.nombre);
    assert.deepEqual(nombres, [...nombres].sort((a, b) => a.localeCompare(b)));
});

test('sin_trabajar: los que nunca se han completado van primero', async () => {
    const { datos } = await call('territorios_sin_trabajar', {});

    assert.equal(datos.territorios[0].id, '4');
    assert.equal(datos.territorios[0].diasSinCompletar, null);
    // Después, del más antiguo al más reciente.
    const conFecha = datos.territorios.slice(1);
    assert.deepEqual(conFecha.map((t) => t.id), ['5', '3', '1', '6', '2']);

    const excluyendo = await call('territorios_sin_trabajar', { incluirNuncaCompletados: false });
    assert.ok(!excluyendo.datos.territorios.some((t) => t.id === '4'));
});

test('sin_trabajar: usa la fecha más reciente entre la columna y el historial', async () => {
    const { datos } = await call('territorios_sin_trabajar', {});
    // El territorio 5 tiene 45810 en las dos columnas: debe interpretarse como fecha.
    assert.equal(datos.territorios.find((t) => t.id === '5').ultimaFinalizacion, '2025-06-02');
});

test('ninguna tool devuelve fechas tal y como están escritas en el Sheet', async () => {
    const salidas = [
        await call('territorios_listar', {}),
        await call('territorios_buscar_por_id', { id: '5' }),
        await call('territorios_buscar_por_publicador', { publicador: 'raquel', soloActuales: false }),
        await call('territorios_sin_trabajar', {}),
        await call('territorios_actividad', { desde: '2020-01-01', hasta: '2030-12-31' }),
    ];

    for (const { texto, datos } of salidas) {
        const json = JSON.stringify(datos);
        assert.ok(!json.includes('45810'), 'el número de serie no debe aparecer como si fuera un dato');
        assert.ok(!json.includes('6/25/2026'), 'las fechas en formato americano deben salir normalizadas');
        assert.ok(!texto.includes('3 de julio de 2026'), 'las fechas en texto deben salir normalizadas');
    }
});

test('los nombres se citan siempre con la misma grafía', async () => {
    const { datos } = await call('territorios_buscar_por_id', { id: '1' });
    assert.equal(datos.publicador, 'Ana López');
    assert.ok(datos.historial.every((h) => h.publicador === 'Ana López'), 'el historial no debe alternar entre grafías');
});

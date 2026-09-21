// Tests de las tools del MCP contra un CSV de ejemplo: `node --test` (npm test).
//
// El CSV está escrito a propósito con las guarradas que aparecen en un Sheet
// rellenado a mano: la misma persona con y sin acento, fechas en formato
// americano, un número de serie de hoja de cálculo, texto donde debería haber
// una fecha y un territorio sin historial.
//
// "Raquel Vidal" y "Marc Vidal" son dos personas distintas cuyos nombres
// colisionan al buscar por el apellido. Es el caso que en producción hizo que
// una tool sumara los territorios de varias personas en una sola cifra.
//
// La última fila reproduce la de totales que cierra la hoja de verdad: sin
// número de territorio y con un texto en la columna de viviendas.
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
7,Les Corts,35,ASIGNADO,12/12/2025,Marc Vidal,07/07/2026,,,,
,,TOTAL 1234,,"*Cuando comience una nueva página, anote en esta columna la última fecha.",,,,,,
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

    assert.equal(datos.total, 5, 'Ana López y "Ana Lopez" son la misma persona');
    const ana = datos.publicadores.find((p) => p.nombre === 'Ana López');
    assert.deepEqual(ana.variantes.sort(), ['Ana López', 'Ana Lopez'].sort());
    assert.deepEqual(ana.idsActuales, ['1']);
});

test('publicadores_listar: filtros y orden', async () => {
    const conTerritorios = await call('publicadores_listar', { soloConTerritorios: true });
    assert.deepEqual(conTerritorios.datos.publicadores.map((p) => p.nombre).sort(), ['Ana López', 'Eric P.', 'Marc Vidal', 'Raquel Vidal']);

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
    // 3 y 7 comparten fecha (12/12/2025); a igualdad, se respeta el orden del Sheet.
    assert.deepEqual(conFecha.map((t) => t.id), ['5', '3', '7', '1', '6', '2']);

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

// ─── Nombres ambiguos ───────────────────────────────────────────────────────
//
// En producción alguien preguntó por un apellido, la tool casó con tres
// personas y devolvió sus cifras SUMADAS en un único resumen. Había un ⚠️
// avisando de las coincidencias y el modelo citó el total igualmente: un aviso
// al lado de una cifra pierde contra la cifra. Así que ahora, con más de un
// nombre, las cifras conjuntas no existen.

test('publicador ambiguo: no se suman las cifras de personas distintas', async () => {
    const { datos, texto } = await call('territorios_buscar_por_publicador', { publicador: 'vidal' });

    assert.equal(datos.resumen.ambiguo, true);
    assert.deepEqual(datos.resumen.nombresCoincidentes, ['Marc Vidal', 'Raquel Vidal']);

    // Lo que importa: el número fusionado (serían 2 territorios entre los dos)
    // no se calcula, así que el modelo no puede citarlo.
    for (const campo of ['territoriosActuales', 'vencidosActuales', 'asignacionesEnRango', 'finalizacionesEnRango', 'diasMediosRetencion', 'ultimaActividad']) {
        assert.equal(datos.resumen[campo], null, `resumen.${campo} debe ser null cuando el nombre es ambiguo`);
    }

    const porNombre = Object.fromEntries(datos.resumen.porPublicador.map((p) => [p.publicador, p]));
    assert.deepEqual(Object.keys(porNombre).sort(), ['Marc Vidal', 'Raquel Vidal']);
    assert.equal(porNombre['Marc Vidal'].territoriosActuales, 1);
    assert.deepEqual(porNombre['Marc Vidal'].idsActuales, ['7']);
    assert.equal(porNombre['Raquel Vidal'].territoriosActuales, 1);
    assert.deepEqual(porNombre['Raquel Vidal'].idsActuales, ['6']);

    // El texto tampoco puede enseñar un total, o el modelo lo copiaría de ahí.
    assert.match(texto, /no identifica a una sola persona/);
    assert.match(texto, /No se dan cifras conjuntas/);
    assert.doesNotMatch(texto, /Territorios asignados ahora:/);
});

test('publicador ambiguo: cada territorio dice de quién es', async () => {
    const { datos, texto } = await call('territorios_buscar_por_publicador', { publicador: 'vidal', soloActuales: false });

    // La lista mezcla personas, así que ninguna línea puede leerse como si
    // todos los territorios fueran de la primera.
    for (const c of datos.coincidencias) {
        assert.ok(['Marc Vidal', 'Raquel Vidal'].includes(c.publicador));
        assert.ok(
            texto.includes(`**Territorio ${c.id}** (${c.zona}): ${c.publicador} —`),
            `la línea del territorio ${c.id} debe atribuirlo a ${c.publicador}`,
        );
    }
});

test('publicador no ambiguo: sigue dando las cifras conjuntas', async () => {
    const { datos } = await call('territorios_buscar_por_publicador', { publicador: 'raquel' });

    assert.equal(datos.resumen.ambiguo, false);
    assert.equal(datos.resumen.porPublicador, undefined);
    assert.equal(datos.resumen.territoriosActuales, 1);
});

// ─── Caducidad ──────────────────────────────────────────────────────────────

test('la caducidad se da hecha y son 122 días, no "cuatro meses"', async () => {
    const { datos, texto } = await call('territorios_buscar_por_id', { id: '7' });

    // Asignado el 07/07/2026. Julio+agosto+septiembre+octubre son 123 días, así
    // que "cuatro meses de calendario" (07/11) se desvía un día de la regla real
    // de la app (122 días -> 06/11). Es exactamente el error que cometía el
    // modelo cuando tenía que calcularlo él.
    assert.equal(datos.fechaCaducidad, '2026-11-06');
    assert.notEqual(datos.fechaCaducidad, '2026-11-07');
    assert.match(texto, /06\/11\/2026/);
});

test('la caducidad sale en todas las tools que dan la fecha de asignación', async () => {
    const listado = await call('territorios_listar', { estado: 'asignado' });
    const siete = listado.datos.territorios.find((t) => t.id === '7');
    assert.equal(siete.fechaCaducidad, '2026-11-06');
    assert.equal(typeof siete.diasParaCaducar, 'number');

    const porPublicador = await call('territorios_buscar_por_publicador', { publicador: 'marc' });
    assert.equal(porPublicador.datos.coincidencias[0].fechaCaducidad, '2026-11-06');
});

test('un territorio libre no tiene caducidad', async () => {
    const { datos } = await call('territorios_buscar_por_id', { id: '4' });
    assert.equal(datos.estado, 'libre');
    assert.equal(datos.fechaCaducidad, null);
    assert.equal(datos.diasParaCaducar, null);
});

// ─── Año de servicio ────────────────────────────────────────────────────────

test('el periodo del año de servicio se resuelve en el servidor', async () => {
    const { datos } = await call('territorios_actividad', { periodo: 'anyo_servicio', evento: 'completados' });

    // Sin asserts sobre el año concreto (depende del día en que se ejecute),
    // pero el año de servicio SIEMPRE empieza un 1 de septiembre.
    assert.match(datos.rangoResuelto.desde, /-09-01$/);
    assert.match(datos.rangoResuelto.etiqueta, /año de servicio \d{4}\/\d{2}/);

    const pasado = await call('territorios_actividad', { periodo: 'anyo_servicio_pasado' });
    assert.match(pasado.datos.rangoResuelto.desde, /-09-01$/);
    assert.match(pasado.datos.rangoResuelto.hasta, /-08-31$/);
});

test('la fila de totales de la hoja no cuenta como un territorio', async () => {
    // La hoja real acaba en una fila "TOTAL 42911" sin número de territorio.
    // Se colaba como territorio asignado (su celda de estado está vacía y vacío
    // no es "LIBRE"), así que el agente contestaba 181 donde hay 180.
    const { datos } = await call('territorios_estadisticas', {});
    assert.equal(datos.total, 7, 'solo los territorios numerados');
    assert.equal(datos.libres + datos.asignados, 7);
    assert.ok(!datos.porZona.some((z) => z.zona === 'Sin zona'), 'la fila de totales no debe crear una zona fantasma');

    const listado = await call('territorios_listar', {});
    assert.ok(listado.datos.territorios.every((t) => t.id && t.id.trim() !== ''), 'ningún territorio sin id');
});

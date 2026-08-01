// Tests del parseo/normalización de fechas: `node --test` (npm test).
//
// Es la parte más delicada del proyecto porque el Sheet se rellena a mano y un
// parseo silenciosamente equivocado desplaza territorios de mes sin que nadie
// lo note.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    daysBetween,
    formatISODate,
    formatSheetDate,
    isWithinRange,
    normalizeText,
    parseSheetDate,
    parseSheetDateDetailed,
    resolveMes,
    resolvePeriodo,
    resolveRango,
} from './dates.js';

const iso = (raw) => formatISODate(parseSheetDate(raw));

test('formatos numéricos habituales', () => {
    assert.equal(iso('03/06/2026'), '2026-06-03');
    assert.equal(iso('3/6/2026'), '2026-06-03');
    assert.equal(iso('03-06-2026'), '2026-06-03');
    assert.equal(iso('03.06.2026'), '2026-06-03');
    assert.equal(iso('3 6 2026'), '2026-06-03');
    assert.equal(iso('  03/06/2026  '), '2026-06-03');
});

test('años de dos dígitos', () => {
    assert.equal(iso('03/06/26'), '2026-06-03');
    assert.equal(iso('3-6-26'), '2026-06-03');
    // Tres dígitos es una errata, no un año.
    assert.equal(parseSheetDate('03/06/206'), null);
});

test('formato ISO (año primero)', () => {
    assert.equal(iso('2026-06-03'), '2026-06-03');
    assert.equal(iso('2026/06/03'), '2026-06-03');
});

test('nombres de mes en español', () => {
    assert.equal(iso('3 de junio de 2026'), '2026-06-03');
    assert.equal(iso('3 junio 2026'), '2026-06-03');
    assert.equal(iso('3-jun-26'), '2026-06-03');
    assert.equal(iso('3 de Septiembre de 2026'), '2026-09-03');
    assert.equal(iso('3 de setiembre de 2026'), '2026-09-03');
});

test('formatos compactos sin separadores', () => {
    assert.equal(iso('03062026'), '2026-06-03');
    assert.equal(iso('030626'), '2026-06-03');
});

test('número de serie de hoja de cálculo', () => {
    // 45810 = 02/06/2025 contando desde la epoch de las hojas de cálculo (30/12/1899).
    assert.equal(iso('45810'), '2025-06-02');
    assert.equal(iso('45658'), '2025-01-01');
    assert.equal(parseSheetDate('123'), null);
});

test('recupera día y mes invertidos (formato americano)', () => {
    const r = parseSheetDateDetailed('6/25/2026');
    assert.equal(formatISODate(r.date), '2026-06-25');
    assert.equal(r.ambigua, true, 'debe marcarse como ambigua para poder auditarla');

    // 06/07 es ambiguo de verdad y no se toca: se respeta la convención día/mes.
    const normal = parseSheetDateDetailed('06/07/2026');
    assert.equal(formatISODate(normal.date), '2026-07-06');
    assert.equal(normal.ambigua, false);
});

test('rechaza lo que no es una fecha', () => {
    for (const raw of ['', '   ', null, undefined, 'pendiente', '31/02/2026', '00/06/2026', '3/13/13/2026', '12/06']) {
        assert.equal(parseSheetDate(raw), null, `debería rechazar: ${JSON.stringify(raw)}`);
    }
});

test('distingue el motivo de un fallo de parseo', () => {
    assert.equal(parseSheetDateDetailed('').motivo, 'vacia');
    assert.equal(parseSheetDateDetailed('pendiente').motivo, 'formato_desconocido');
    assert.equal(parseSheetDateDetailed('03/06/2026').motivo, null);
});

test('formateo de salida', () => {
    assert.equal(formatSheetDate(new Date(2026, 5, 3)), '03/06/2026');
    assert.equal(formatISODate(new Date(2026, 5, 3)), '2026-06-03');
    assert.equal(formatISODate(null), null);
    assert.equal(formatSheetDate(new Date('nope')), null);
});

test('normalizeText quita acentos y mayúsculas', () => {
    assert.equal(normalizeText('  Núria   Pérez '), 'nuria perez');
    assert.equal(normalizeText(null), '');
});

test('daysBetween ignora la hora', () => {
    assert.equal(daysBetween(new Date(2026, 5, 1), new Date(2026, 5, 30, 23, 59)), 29);
    assert.equal(daysBetween(new Date(2026, 5, 30), new Date(2026, 5, 1)), -29);
});

// Miércoles 5 de agosto de 2026: fijamos "hoy" para que los tests no dependan del reloj.
const AHORA = new Date(2026, 7, 5, 12, 0, 0);

test('periodos relativos se resuelven en el servidor', () => {
    const casos = {
        hoy: ['2026-08-05', '2026-08-05'],
        ayer: ['2026-08-04', '2026-08-04'],
        esta_semana: ['2026-08-03', '2026-08-05'],
        semana_pasada: ['2026-07-27', '2026-08-02'],
        ultimos_7_dias: ['2026-07-30', '2026-08-05'],
        este_mes: ['2026-08-01', '2026-08-05'],
        mes_pasado: ['2026-07-01', '2026-07-31'],
        ultimos_30_dias: ['2026-07-07', '2026-08-05'],
        ultimos_3_meses: ['2026-05-05', '2026-08-05'],
        ultimos_6_meses: ['2026-02-05', '2026-08-05'],
        ultimo_ano: ['2025-08-05', '2026-08-05'],
        este_ano: ['2026-01-01', '2026-08-05'],
        ano_pasado: ['2025-01-01', '2025-12-31'],
    };

    for (const [periodo, [desde, hasta]] of Object.entries(casos)) {
        const r = resolvePeriodo(periodo, AHORA);
        assert.equal(formatISODate(r.desde), desde, `${periodo}: desde`);
        assert.equal(formatISODate(r.hasta), hasta, `${periodo}: hasta`);
    }

    assert.equal(resolvePeriodo('la semana que viene', AHORA), null);
});

test('la semana empieza en lunes', () => {
    const domingo = new Date(2026, 7, 9, 10, 0, 0);
    const r = resolvePeriodo('esta_semana', domingo);
    assert.equal(formatISODate(r.desde), '2026-08-03');
});

test('los periodos incluyen el día entero final', () => {
    const r = resolvePeriodo('mes_pasado', AHORA);
    assert.ok(isWithinRange(new Date(2026, 6, 31), r.desde, r.hasta), '31 de julio debe entrar en "mes pasado"');
    assert.ok(!isWithinRange(new Date(2026, 7, 1), r.desde, r.hasta));
});

test('resolveMes acepta varias formas de nombrar un mes', () => {
    for (const entrada of ['2026-06', '06/2026', 'junio 2026', '2026 junio', 'junio de 2026']) {
        const r = resolveMes(entrada, AHORA);
        assert.equal(formatISODate(r.desde), '2026-06-01', entrada);
        assert.equal(formatISODate(r.hasta), '2026-06-30', entrada);
    }
    assert.equal(resolveMes('nosequé', AHORA), null);
});

test('un mes sin año es la última vez que ocurrió', () => {
    // En agosto de 2026, "junio" ya ha pasado este año.
    assert.equal(formatISODate(resolveMes('junio', AHORA).desde), '2026-06-01');
    // "diciembre" todavía no ha llegado en 2026, así que es el de 2025.
    assert.equal(formatISODate(resolveMes('diciembre', AHORA).desde), '2025-12-01');
    // El mes en curso cuenta como el actual.
    assert.equal(formatISODate(resolveMes('agosto', AHORA).desde), '2026-08-01');
});

test('resolveRango: precedencia desde/hasta > mes > periodo', () => {
    const r = resolveRango({ desde: '2026-06-10', hasta: '2026-06-20', mes: 'junio', periodo: 'mes_pasado', now: AHORA });
    assert.equal(formatISODate(r.desde), '2026-06-10');
    assert.equal(formatISODate(r.hasta), '2026-06-20');
    assert.equal(r.avisos.length, 1, 'debe avisar de que ignora los otros filtros');

    const soloMes = resolveRango({ mes: 'junio', periodo: 'mes_pasado', now: AHORA });
    assert.equal(formatISODate(soloMes.desde), '2026-06-01');
});

test('resolveRango: rangos abiertos y sin filtros', () => {
    const soloDesde = resolveRango({ desde: '2026-06-10', now: AHORA });
    assert.equal(formatISODate(soloDesde.hasta), '2026-08-05', 'sin "hasta" el rango llega hasta hoy');

    const soloHasta = resolveRango({ hasta: '2026-06-10', now: AHORA });
    assert.equal(soloHasta.desde, null, 'sin "desde" el rango queda abierto por la izquierda');

    const sinNada = resolveRango({ now: AHORA });
    assert.equal(sinNada.desde, null);
    assert.equal(sinNada.hasta, null);
    assert.equal(sinNada.error, null);
});

test('resolveRango: errores explicativos', () => {
    assert.match(resolveRango({ desde: 'el martes', now: AHORA }).error, /desde/);
    assert.match(resolveRango({ hasta: 'ni idea', now: AHORA }).error, /hasta/);
    assert.match(resolveRango({ desde: '2026-06-20', hasta: '2026-06-10', now: AHORA }).error, /inválido/);
    assert.match(resolveRango({ periodo: 'el trimestre pasado', now: AHORA }).error, /Periodo desconocido/);
    assert.match(resolveRango({ mes: 'trece', now: AHORA }).error, /mes/);
});

test('resolveRango acepta fechas escritas a mano, no solo ISO', () => {
    const r = resolveRango({ desde: '10/06/2026', hasta: '20 de junio de 2026', now: AHORA });
    assert.equal(formatISODate(r.desde), '2026-06-10');
    assert.equal(formatISODate(r.hasta), '2026-06-20');
});

test('isWithinRange con extremos abiertos', () => {
    const d = new Date(2026, 5, 15);
    assert.ok(isWithinRange(d, null, null));
    assert.ok(isWithinRange(d, new Date(2026, 5, 1), null));
    assert.ok(!isWithinRange(d, new Date(2026, 6, 1), null));
    assert.ok(!isWithinRange(null, null, null));
});

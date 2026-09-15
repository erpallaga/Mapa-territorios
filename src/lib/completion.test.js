// Tests de la lógica de "últimos 12 meses": `node --test` (npm test).
//
// Es la parte que decide si un territorio sale como trabajado en el panel y en
// el mapa. Todo va con una fecha "hoy" fija: nada de asserts que cambien según
// el día en que se ejecuten.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CATEGORIA_0_6,
    CATEGORIA_6_12,
    CATEGORIA_MAS_12,
    CATEGORIA_SIN_FECHA,
    categoria12m,
    finalizacionesUltimos12Meses,
    mesesDesdeFinalizacion,
    trabajadoUltimos12Meses,
    ultimaFinalizacionDetallada,
} from './completion.js';

const HOY = new Date(2026, 8, 15); // 15/09/2026

const territorio = (lastCompletedDate, completadas = []) => ({
    lastCompletedDate,
    history: completadas.map((completedDate) => ({ publisher: 'X', assignedDate: '', completedDate })),
});

test('cruza la columna y el historial y se queda con la más reciente', () => {
    // La columna se ha quedado atrás.
    const a = ultimaFinalizacionDetallada(territorio('10/01/2026', ['20/06/2026']), HOY);
    assert.equal(a.fuente, 'historial');
    assert.deepEqual(a.date, new Date(2026, 5, 20));

    // El historial se ha quedado atrás.
    const b = ultimaFinalizacionDetallada(territorio('20/06/2026', ['10/01/2026']), HOY);
    assert.equal(b.fuente, 'columna');

    // Las dos dicen lo mismo, que es el caso normal.
    const c = ultimaFinalizacionDetallada(territorio('20/06/2026', ['20/06/2026']), HOY);
    assert.equal(c.fuente, 'ambas');
});

test('una fecha posterior a hoy es una errata, no una finalización', () => {
    // Éste era el fallo: un "2027" tecleado por error ascendía el territorio a
    // "trabajado hace 0-6 meses" y lo pintaba de azul en el mapa.
    const t = territorio('01/01/2027', ['10/10/2024']);
    const info = ultimaFinalizacionDetallada(t, HOY);

    assert.equal(info.futuras, 1);
    assert.deepEqual(info.date, new Date(2024, 9, 10));
    assert.equal(categoria12m(t, HOY), CATEGORIA_MAS_12);
    assert.equal(trabajadoUltimos12Meses(t, HOY), false);
});

test('sin ninguna fecha legible no se inventa una categoría', () => {
    assert.equal(categoria12m(territorio(''), HOY), CATEGORIA_SIN_FECHA);
    assert.equal(categoria12m(territorio('pendiente', ['']), HOY), CATEGORIA_SIN_FECHA);
    assert.equal(mesesDesdeFinalizacion(territorio(''), HOY), Infinity);
    assert.equal(trabajadoUltimos12Meses(territorio(''), HOY), false);
});

test('los cortes de 6 y 12 meses caen en el mismo día', () => {
    assert.equal(categoria12m(territorio('15/03/2026'), HOY), CATEGORIA_0_6); // justo 6 meses
    assert.equal(categoria12m(territorio('14/03/2026'), HOY), CATEGORIA_6_12); // un día más
    assert.equal(categoria12m(territorio('15/09/2025'), HOY), CATEGORIA_6_12); // justo 12 meses
    assert.equal(categoria12m(territorio('14/09/2025'), HOY), CATEGORIA_MAS_12); // un día más
});

test('el corte no se mueve según la hora a la que se mire', () => {
    const manana = new Date(2026, 8, 15, 8, 0, 0);
    const noche = new Date(2026, 8, 15, 23, 30, 0);
    const t = territorio('15/03/2026');
    assert.equal(categoria12m(t, manana), categoria12m(t, noche));
});

test('en un mes corto el corte no se desborda al mes siguiente', () => {
    // 31/08 menos 6 meses no puede ser el 3 de marzo.
    const hoy = new Date(2026, 7, 31); // 31/08/2026
    assert.equal(categoria12m(territorio('28/02/2026'), hoy), CATEGORIA_0_6);
    assert.equal(categoria12m(territorio('27/02/2026'), hoy), CATEGORIA_6_12);
});

test('cuenta las finalizaciones del historial dentro de la ventana', () => {
    const t = territorio('20/06/2026', ['10/10/2024', '05/12/2025', '20/06/2026', '01/01/2027']);
    // Fuera: la de 2024 (vieja) y la de 2027 (futura).
    assert.equal(finalizacionesUltimos12Meses(t, HOY), 2);
});

test('un territorio que consta trabajado puede no tener eventos en el historial', () => {
    // Es la discrepancia que `auditar-12m` saca a la luz: la columna está al día
    // pero las celdas de "completado" del historial están sin rellenar.
    const t = territorio('10/02/2026', []);
    assert.equal(trabajadoUltimos12Meses(t, HOY), true);
    assert.equal(finalizacionesUltimos12Meses(t, HOY), 0);
});

test('acepta un territorio sin historial sin reventar', () => {
    assert.equal(categoria12m({ lastCompletedDate: '15/03/2026' }, HOY), CATEGORIA_0_6);
    assert.equal(categoria12m({}, HOY), CATEGORIA_SIN_FECHA);
    assert.equal(categoria12m(undefined, HOY), CATEGORIA_SIN_FECHA);
});

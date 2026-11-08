import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUNTOS_REUNION, glifoSvg, TIPO_CASA, TIPO_PUNTO, TIPO_SALON } from './puntosReunion.js';
import { escapeHtml } from './escapeHtml.js';

test('11 puntos, ids únicos y coordenadas en el área de Barcelona', () => {
    assert.equal(PUNTOS_REUNION.length, 11);
    assert.equal(new Set(PUNTOS_REUNION.map((p) => p.id)).size, 11);
    for (const p of PUNTOS_REUNION) {
        const [lat, lng] = p.coords;
        assert.ok(lat > 41.35 && lat < 41.42 && lng > 2.09 && lng < 2.17, `${p.id} fuera de Barcelona`);
        assert.ok(p.horarios.length > 0, `${p.id} sin horario`);
    }
});

test('ningún punto lleva dirección (privacidad)', () => {
    for (const p of PUNTOS_REUNION) {
        assert.deepEqual(Object.keys(p).filter((k) => /direcc|calle|address|portal/i.test(k)), []);
    }
    const fuente = readFileSync(new URL('./puntosReunion.js', import.meta.url), 'utf8');
    for (const calle of ['Vallespir', 'Alpens', 'Sant Medir', 'Pobla de Lillet', 'Miquel Àngel', 'Occidente']) {
        assert.ok(!fuente.includes(calle), `la calle ${calle} está en el bundle`);
    }
});

test('cada tipo tiene glifo y escapeHtml neutraliza HTML', () => {
    for (const t of [TIPO_CASA, TIPO_PUNTO, TIPO_SALON]) assert.match(glifoSvg(t), /<path/);
    assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});

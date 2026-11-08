import React, { useMemo, useState } from 'react';
import L from 'leaflet';
import { Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import { escapeHtml } from '../lib/escapeHtml';
import { PUNTOS_REUNION, ZOOM_MINIMO_ETIQUETA, glifoSvg } from '../lib/puntosReunion';

// Marino: no coincide con ningún color de estado de los territorios (verde,
// rojo, ámbar, azules claros, gris), así que un marcador de reunión no se
// confunde con un territorio.
const MARINO = '#17313e';
const DIAMETRO = 30;

function crearIcono(punto, conEtiqueta) {
    const circulo = `<div style="display:flex;align-items:center;justify-content:center;width:${DIAMETRO}px;height:${DIAMETRO}px;background:#fff;border:2px solid ${MARINO};border-radius:9999px;box-shadow:0 1px 3px rgba(0,0,0,0.3);flex:none;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${MARINO}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${glifoSvg(punto.tipo)}</svg></div>`;
    const etiqueta = conEtiqueta
        ? `<div style="margin-top:2px;padding:1px 6px;background:${MARINO};color:#fff;border-radius:9999px;font-size:11px;font-weight:600;line-height:1.35;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.25);">${escapeHtml(punto.nombre)}</div>`
        : '';

    // El ancla es el centro del círculo, no del conjunto: la etiqueta cuelga
    // debajo y el icono queda justo sobre el sitio.
    return L.divIcon({
        className: 'punto-reunion-icon',
        html: `<div style="display:flex;flex-direction:column;align-items:center;width:max-content;transform:translateX(-50%);margin-left:${DIAMETRO / 2}px;">${circulo}${etiqueta}</div>`,
        iconSize: [DIAMETRO, DIAMETRO],
        iconAnchor: [DIAMETRO / 2, DIAMETRO / 2],
    });
}

export function PuntosReunion() {
    const map = useMap();
    const [conEtiqueta, setConEtiqueta] = useState(map.getZoom() >= ZOOM_MINIMO_ETIQUETA);

    useMapEvents({
        zoomend: () => setConEtiqueta(map.getZoom() >= ZOOM_MINIMO_ETIQUETA),
    });

    // Un `L.divIcon` nuevo por render haría que react-leaflet reemplazara el
    // DOM de los marcadores; solo cambia al cruzar el umbral de zoom.
    const marcadores = useMemo(
        () => PUNTOS_REUNION.map((p) => ({ punto: p, icono: crearIcono(p, conEtiqueta) })),
        [conEtiqueta],
    );

    return marcadores.map(({ punto, icono }) => (
        <Marker
            key={punto.id}
            position={punto.coords}
            icon={icono}
            zIndexOffset={1000}
            title={punto.nombre}
        >
            <Popup>
                <div className="text-sm">
                    <strong>{punto.nombre}</strong>
                    <ul className="mt-1 space-y-1 list-none p-0 m-0">
                        {punto.horarios.map((h) => (
                            <li key={`${h.dia}-${h.hora}`}>
                                {h.dia}, {h.hora}
                                {h.nota && <div className="text-xs text-gray-500">{h.nota}</div>}
                            </li>
                        ))}
                    </ul>
                </div>
            </Popup>
        </Marker>
    ));
}

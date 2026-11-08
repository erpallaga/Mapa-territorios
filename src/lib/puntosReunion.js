// Puntos de reunión para el servicio del campo (programa semanal de
// Sarrià – Les Corts).
//
// Es una fuente propia y estática, distinta de la hoja de Google: el programa
// cambia pocas veces al año y no tiene nada que ver con el estado de los
// territorios. Cuando salga un programa nuevo se edita este archivo.
//
// PRIVACIDAD: aquí solo hay nombre del lugar y coordenadas, a propósito. Este
// módulo viaja en el bundle que baja el navegador, así que una dirección
// completa (calle, portal, piso) escrita aquí sería visible para cualquier
// usuario activo con las herramientas de desarrollo. Las direcciones del PDF
// no se guardan en el repositorio.
//
// `aproximada: true` = la dirección exacta no se pudo resolver y el marcador
// está sobre la calle o la parada, no sobre el portal.

export const TIPO_CASA = 'casa';
export const TIPO_PUNTO = 'punto';
export const TIPO_SALON = 'salon';

export const PUNTOS_REUNION = [
    {
        id: 'munoz', nombre: 'Familia Muñoz', tipo: TIPO_CASA,
        coords: [41.38022, 2.12957],
        horarios: [{ dia: 'Lunes', hora: '10:00' }],
    },
    {
        id: 'gavidia', nombre: 'Carlos Gavidia', tipo: TIPO_CASA,
        coords: [41.38377, 2.13391],
        horarios: [{ dia: 'Martes', hora: '10:00' }],
    },
    {
        id: 'moreno', nombre: 'Mari Carmen Moreno', tipo: TIPO_CASA,
        coords: [41.37476, 2.13283],
        horarios: [{ dia: 'Miércoles', hora: '10:00', nota: 'El tercer miércoles la salida es en el metro de Palau Reial (L3)' }],
    },
    {
        id: 'prat-de-la-riba', nombre: 'Pl. Prat de la Riba', tipo: TIPO_PUNTO,
        coords: [41.39227, 2.12967],
        horarios: [
            { dia: 'Jueves', hora: '10:00' },
            { dia: 'Último martes de mes', hora: '18:00', nota: 'Sustituye a Jardins Josep Goday i Casals' },
        ],
    },
    {
        id: 'salon-del-reino', nombre: 'Salón del Reino', tipo: TIPO_SALON,
        coords: [41.37230, 2.14043],
        horarios: [{ dia: 'Sábado', hora: '10:00', nota: 'Reunión híbrida' }],
    },
    {
        id: 'raposo', nombre: 'Familia Raposo', tipo: TIPO_CASA,
        coords: [41.37749, 2.12659],
        horarios: [{ dia: 'Domingo', hora: '10:00' }],
    },
    {
        id: 'jardins-goday', nombre: 'Jardins Josep Goday i Casals', tipo: TIPO_PUNTO,
        coords: [41.37855, 2.12601],
        horarios: [{ dia: 'Martes', hora: '18:00', nota: 'El último martes de mes la salida es en la Pl. Prat de la Riba' }],
    },
    {
        id: 'trallero-fuentes', nombre: 'Familia Trallero - Fuentes', tipo: TIPO_CASA,
        coords: [41.38638, 2.12648],
        horarios: [{ dia: 'Miércoles', hora: '17:00', nota: '1.ª y 3.ª semana' }],
    },
    {
        id: 'mora', nombre: 'Familia Mora', tipo: TIPO_CASA,
        // L'Hospitalet, fuera del área de los territorios. La calle se resolvió,
        // el número no: el marcador está sobre la calle.
        coords: [41.37457, 2.11898], aproximada: true,
        horarios: [{ dia: 'Miércoles', hora: '17:00', nota: '2.ª y 4.ª semana' }],
    },
    {
        id: 'pallares', nombre: 'Familia Pallarés', tipo: TIPO_CASA,
        coords: [41.37658, 2.12868],
        horarios: [{ dia: 'Jueves', hora: '17:00' }],
    },
    {
        id: 'metro-palau-reial', nombre: 'Metro Palau Reial (L3)', tipo: TIPO_PUNTO,
        // Solo el tercer miércoles de mes. Posición de la parada de bus
        // "Diagonal - Metro Palau Reial", junto a la boca del metro.
        coords: [41.38585, 2.11876], aproximada: true,
        horarios: [{ dia: 'Tercer miércoles de mes', hora: '10:00' }],
    },
];

// Rutas de los iconos `House`, `MapPin` y `Building2` de lucide-react: los
// mismos tres símbolos de contorno que usa el PDF del programa. Van en línea
// porque el icono de Leaflet es una cadena de HTML, no un componente React.
const GLIFOS = {
    [TIPO_CASA]: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    [TIPO_PUNTO]: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    [TIPO_SALON]: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
};

export function glifoSvg(tipo) {
    return GLIFOS[tipo] || GLIFOS[TIPO_PUNTO];
}

// Por debajo de este zoom solo se dibuja el círculo con el icono: once
// etiquetas con nombre más los números de las otras vistas no se leen.
export const ZOOM_MINIMO_ETIQUETA = 15;

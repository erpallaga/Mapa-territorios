/**
 * Los popups y `divIcon` de Leaflet se insertan como HTML, y lo que se
 * interpola sale de una hoja que se rellena a mano. Sin escapar, un "<" en un
 * nombre rompía el popup, y cualquiera con permiso de edición en la hoja podía
 * inyectar HTML en la app.
 */
export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

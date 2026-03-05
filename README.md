# Mapa Territorios 🗺️

Aplicación web avanzada para la visualización y gestión de asignación de territorios sobre un mapa interactivo, protegida mediante autenticación corporativa y con panel de administración integral.

## 🚀 Características Principales

- **Mapa Interactivo Premium**: Visualización de territorios mediante datos KML/KMZ con renderizado optimizado.
- **Estado en Tiempo Real**: Código de colores dinámico (Verde: Libre, Rojo: Asignado) sincronizado con Google Sheets.
- **Dashboard de Estadísticas**: Análisis visual de la cobertura y antigüedad de los territorios.
- **Autenticación Google OAuth**: Acceso exclusivo para usuarios invitados mediante sus cuentas de Google.
- **Panel de Administración**: 
  - Gestión de usuarios y roles (Admin/User).
  - Sistema de invitaciones por email automatizado.
  - Auditoría completa de acciones administrativas (Logs).
  - Eliminación segura de cuentas con limpieza en cascada.

## 🛠️ Stack Tecnológico

- **Frontend**: [React](https://reactjs.org/) + [Vite](https://vitejs.dev/)
- **Gestión de Estado**: Context API con optimización de renderizado y persistencia de sesión.
- **Mapas**: [Leaflet](https://leafletjs.com/) / React-Leaflet.
- **Estilos**: [Tailwind CSS](https://tailwindcss.com/) con diseño responsivo y premium.
- **Backend / BaaS**: [Supabase](https://supabase.com/)
  - **Auth**: Google OAuth 2.0.
  - **Database**: PostgreSQL con RLS (Row Level Security) avanzado.
  - **Edge Functions**: TypeScript (Deno) para envío de invitaciones y gestión segura de usuarios.

## ⚙️ Arquitectura Técnica y Optimizaciones

### 1. Robustez en la Autenticación (`AuthContext`)
Se ha implementado una capa de seguridad y estabilidad superior para evitar los bloqueos típicos de aplicaciones web en entornos móviles:
- **Retry Mechanism**: Lógica de reintentos con *exponential backoff* para la obtención del perfil de usuario, manejando latencias de disparadores (triggers) de base de datos.
- **Functional State Updates**: Resolución del bug de *stale closures* (cierres obsoletos) asegurando que los refrescos de sesión en segundo plano no provoquen "lockouts" accidentales.
- **Safety Timeouts**: Timeouts técnicos de 10s para garantizar que la UI nunca se quede en un estado de carga infinito.

### 2. Rendimiento de Base de Datos
- **RLS Optimizado**: Las políticas de seguridad utilizan una función `is_admin()` con `SECURITY DEFINER` y `search_path` fijo para maximizar la velocidad y evitar recursividad en consultas complejas.
- **Memoización**: El contexto de autenticación está memoizado para evitar re-renderizados innecesarios del mapa y del dashboard durante actualizaciones de sesión.

## 💻 Instalación y Configuración

### Prerrequisitos
- Node.js (v18+)
- Cuenta de Supabase con Google OAuth configurado.

### Configuración de Pasos
1. Clona el repositorio.
2. Instala dependencias: `npm install`
3. Configura las variables de entorno en un archivo `.env`:
   ```env
   VITE_SUPABASE_URL=tu_url_supabase
   VITE_SUPABASE_ANON_KEY=tu_anon_key
   ```
4. Inicia el servidor de desarrollo: `npm run dev`

## 📦 Despliegue (Vercel)

El proyecto está configurado para despliegue continuo en Vercel. El script de `build` procesa automáticamente los archivos KML a JSON antes de generar el paquete estático.

### Actualización de Datos del Mapa
1. Añade o reemplaza archivos KML en el directorio `/kmlfiles`.
2. Sube los cambios a GitHub.
3. Vercel reconstruirá el sitio automáticamente con los nuevos polígonos.

---
**Mapa Territorios** - Desarrollado con foco en seguridad, fluidez y experiencia de usuario premium.

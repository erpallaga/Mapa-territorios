import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { Map } from './components/Map'
import { TerritoryDetails } from './components/TerritoryDetails'
import { AskTerritorios } from './components/AskTerritorios'
import { LoginPage, AccessPending } from './components/LoginPage'
import { useAuth } from './context/AuthContext'
import { SHEET_CSV_URL, loadTerritoryData } from './lib/sheets'
import { mergeTerritoryData } from './lib/territories'
import { LayoutDashboard, Map as MapIcon, ShieldCheck, LogOut, AlertTriangle, RefreshCw } from 'lucide-react'
import { cn } from './lib/utils'
import { UserAvatar } from './components/UserAvatar'

// Bajo demanda: el Resumen arrastra recharts y el panel de admin solo lo ven
// los administradores. Así la primera carga (el mapa) no los descarga.
const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })))
const AdminPanel = lazy(() => import('./components/AdminPanel').then(m => ({ default: m.AdminPanel })))

function Cargando() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
    </div>
  )
}

// Si la pestaña vuelve a estar visible y los datos tienen más de esto, se
// recargan. La app se deja abierta en el móvil durante días, y sin esto la
// hoja podía haber cambiado mucho sin que el mapa se enterase.
const RECARGA_AL_VOLVER_MS = 5 * 60 * 1000;
// Una red que no contesta no puede dejar la rueda girando para siempre.
const TIMEOUT_CARGA_MS = 20000;

function conTimeout(promise, ms) {
  let timer;
  const limite = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('La carga de datos está tardando demasiado. Comprueba la conexión.')), ms);
  });
  return Promise.race([promise, limite]).finally(() => clearTimeout(timer));
}

function App() {
  const { user, profile, loading: authLoading, signOut, isAdmin, isActive } = useAuth()
  const [view, setView] = useState('map'); // 'map' | 'dashboard' | 'admin'
  const [territories, setTerritories] = useState(null);
  const [selectedTerritory, setSelectedTerritory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // Cambia en cada carga: el mapa lo usa para volver a pintar los polígonos,
  // porque el <GeoJSON> de react-leaflet ignora los cambios de `data`.
  const [dataVersion, setDataVersion] = useState(0);
  const loadedAt = useRef(0);
  const loadingRef = useRef(false);

  const loadData = useCallback(async ({ background = false } = {}) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!background) setLoading(true);
    try {
      const [geoJson, sheetData] = await conTimeout(Promise.all([
        fetch('/data/territories.json').then(r => {
          if (!r.ok) throw new Error(`No se pudo cargar el mapa (HTTP ${r.status}).`);
          return r.json();
        }),
        // Antes un fallo de la hoja devolvía [] en silencio y el mapa salía
        // entero en rojo, como si todo estuviera asignado.
        loadTerritoryData(SHEET_CSV_URL),
      ]), TIMEOUT_CARGA_MS);
      const mergedData = mergeTerritoryData(geoJson, sheetData);
      setTerritories(mergedData);
      setDataVersion(v => v + 1);
      setLoadError(null);
      loadedAt.current = Date.now();
      // El panel de detalle guarda una copia del territorio: se sustituye por
      // la versión recién cargada para que no enseñe datos viejos.
      setSelectedTerritory(prev => {
        if (!prev?.id) return prev;
        const fresh = mergedData.features.find(f => f.properties?.id === prev.id);
        return fresh ? fresh.properties : prev;
      });
    } catch (error) {
      console.error("[App] Failed to load data:", error);
      // En una recarga en segundo plano se conservan los datos que ya había.
      if (!background) setLoadError(error.message || 'No se pudieron cargar los datos.');
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Only load data when user is authenticated and active
    if (!user?.id || !isActive) return;
    loadData();
  }, [user?.id, isActive, loadData]);

  useEffect(() => {
    if (!user?.id || !isActive) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && loadedAt.current && Date.now() - loadedAt.current > RECARGA_AL_VOLVER_MS) {
        loadData({ background: true });
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user?.id, isActive, loadData]);

  const handleTerritoryClick = (territory) => {
    setSelectedTerritory(territory);
  };

  // Auth loading state
  if (authLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  // Not authenticated → Login
  if (!user) {
    return <LoginPage />
  }

  // Authenticated but not active → Access pending
  if (!isActive) {
    return <AccessPending onLogout={signOut} email={profile?.email || user?.email} />
  }

  return (
    <div className="flex h-[100dvh] w-full bg-gray-50 overflow-hidden">
      {/* Sidebar Navigation (Desktop) */}
      <aside className="hidden md:flex w-16 flex-col items-center py-6 bg-white border-r border-gray-200 z-10">
        <div className="mb-8">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-gray-100 overflow-hidden">
            <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" />
          </div>
        </div>
        <nav className="flex flex-col gap-4">
          <NavButton
            active={view === 'map'}
            onClick={() => setView('map')}
            icon={<MapIcon className="w-6 h-6" />}
            label="Mapa"
          />
          <NavButton
            active={view === 'dashboard'}
            onClick={() => setView('dashboard')}
            icon={<LayoutDashboard className="w-6 h-6" />}
            label="Resumen"
          />
          {isAdmin && (
            <NavButton
              active={view === 'admin'}
              onClick={() => setView('admin')}
              icon={<ShieldCheck className="w-6 h-6" />}
              label="Admin"
            />
          )}
        </nav>

        {/* User menu at bottom */}
        <div className="user-menu">
          <UserAvatar user={profile || user} className="user-menu-avatar w-9 h-9 text-sm" />
          <button
            onClick={signOut}
            className="p-2 rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-all duration-200"
            title="Cerrar sesión"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 relative h-full pt-16 md:pt-0">
        {view === 'admin' && isAdmin ? (
          <Suspense fallback={<Cargando />}>
            <AdminPanel />
          </Suspense>
        ) : loading ? (
          <Cargando />
        ) : loadError && !territories ? (
          <div className="h-full flex items-center justify-center p-6">
            <div className="max-w-sm text-center bg-white border border-gray-200 rounded-xl shadow-sm p-6">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
              <h2 className="font-semibold text-gray-900 mb-1">No se pudieron cargar los territorios</h2>
              <p className="text-sm text-gray-500 mb-4">{loadError}</p>
              <button
                onClick={() => loadData()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Reintentar
              </button>
            </div>
          </div>
        ) : (
          <>
            {view === 'map' && (
              <div className="h-full w-full relative">
                <Map
                  territories={territories}
                  dataVersion={dataVersion}
                  onTerritoryClick={handleTerritoryClick}
                  selectedTerritory={selectedTerritory}
                />
                <TerritoryDetails
                  territory={selectedTerritory}
                  isOpen={!!selectedTerritory}
                  onClose={() => setSelectedTerritory(null)}
                />
              </div>
            )}
            {view === 'dashboard' && (
              <div className="h-full p-8 overflow-y-auto">
                <div className="max-w-5xl mx-auto h-[600px]">
                  <Suspense fallback={<Cargando />}>
                    <Dashboard territories={territories?.features} />
                  </Suspense>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <AskTerritorios />

      {/* Mobile Navigation (Top Bar) */}
      <div className="md:hidden fixed top-0 left-0 right-0 min-h-[64px] pb-2 pt-2 bg-white/75 backdrop-blur-lg border-b border-gray-200 flex items-center justify-between px-3 z-50">
        <div className="flex items-center shrink-0 mr-2">
          <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center shadow-sm border border-gray-100 overflow-hidden shrink-0">
            <img src="/logo.png" alt="Territorios Sarrià-Les Corts" className="w-full h-full object-cover" />
          </div>
        </div>

        {/* Segmented Control */}
        <div className="flex bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setView('map')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
              view === 'map'
                ? "bg-white text-blue-600 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span>Mapa</span>
          </button>
          <button
            onClick={() => setView('dashboard')}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
              view === 'dashboard'
                ? "bg-white text-blue-600 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Resumen</span>
          </button>
          {isAdmin && (
            <button
              onClick={() => setView('admin')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                view === 'admin'
                  ? "bg-white text-purple-600 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Admin</span>
            </button>
          )}
        </div>

        {/* Mobile user menu */}
        <button
          onClick={signOut}
          className="ml-2 p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-all"
          title="Cerrar sesión"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function NavButton({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "p-3 rounded-xl transition-all duration-200 group relative",
        active
          ? "bg-blue-50 text-blue-600"
          : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      )}
      title={label}
    >
      {icon}
      {active && (
        <span className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-600 rounded-l-full hidden md:block translate-x-full" />
      )}
    </button>
  );
}

export default App

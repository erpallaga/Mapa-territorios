import { useState, useEffect } from 'react'
import { Map } from './components/Map'
import { TerritoryDetails } from './components/TerritoryDetails'
import { Dashboard } from './components/Dashboard'
import { AdminPanel } from './components/AdminPanel'
import { LoginPage, AccessPending } from './components/LoginPage'
import { useAuth } from './context/AuthContext'
import { fetchTerritoryData } from './lib/sheets'
import { mergeTerritoryData } from './lib/territories'
import { LayoutDashboard, Map as MapIcon, ShieldCheck, LogOut } from 'lucide-react'
import { cn } from './lib/utils'

function App() {
  const { user, profile, loading: authLoading, signOut, isAdmin, isActive } = useAuth()
  const [view, setView] = useState('map'); // 'map' | 'dashboard' | 'admin'
  const [territories, setTerritories] = useState(null);
  const [selectedTerritory, setSelectedTerritory] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Only load data when user is authenticated and active
    if (!user || !isActive) return;

    async function loadData() {
      try {
        const geoResponse = await fetch('/data/territories.json');
        const geoJson = await geoResponse.json();
        const sheetData = await fetchTerritoryData('https://docs.google.com/spreadsheets/d/e/2PACX-1vQugwzM2d854XUSxfQBG-UXngD8bhKp-Tt72E_BEgeS80PtoQXNQg0YTFOt70iNE3s3sr2b6NSOfZoo/pub?output=csv');
        const mergedData = mergeTerritoryData(geoJson, sheetData);
        setTerritories(mergedData);
      } catch (error) {
        console.error("Failed to load data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [user, isActive]);

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
    <div className="flex h-screen w-full bg-gray-50 overflow-hidden">
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
          <img
            src={profile?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile?.full_name || profile?.email || '')}&background=6366f1&color=fff&size=36`}
            alt="Avatar"
            className="user-menu-avatar"
            title={profile?.email}
          />
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
          <AdminPanel />
        ) : loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <>
            {view === 'map' && (
              <div className="h-full w-full relative">
                <Map
                  territories={territories}
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
                  <Dashboard territories={territories?.features} />
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Mobile Navigation (Top Bar) */}
      <div className="md:hidden fixed top-0 left-0 right-0 min-h-[64px] pb-2 pt-2 bg-white/75 backdrop-blur-lg border-b border-gray-200 flex items-center justify-between px-3 z-50">
        <div className="flex items-center gap-2 flex-1 min-w-0 mr-2">
          <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center shadow-sm border border-gray-100 overflow-hidden shrink-0">
            <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" />
          </div>
          <span className="font-bold text-gray-900 text-[11px] leading-tight break-words">
            Territorios Sarrià-Les Corts
          </span>
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

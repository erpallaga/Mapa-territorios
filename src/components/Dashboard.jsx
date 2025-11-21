import React, { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

export function Dashboard({ territories }) {
    const [viewMode, setViewMode] = useState('current'); // 'current' | '12months'

    if (!territories) return null;

    // Process data: Deduplicate and calculate stats
    const { uniqueTerritories, stats, chartData, zoneStats } = useMemo(() => {
        const uniqueMap = new Map();

        // Deduplicate by ID
        territories.forEach(t => {
            const id = t.properties.id;
            if (id && !uniqueMap.has(id)) {
                uniqueMap.set(id, t);
            }
        });

        const unique = Array.from(uniqueMap.values());
        const total = unique.length;

        // Helper to check if worked in last 12 months
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const isRecentlyWorked = (t) => {
            const dateStr = t.properties.lastCompletedDate;
            if (!dateStr) return false;
            const [day, month, year] = dateStr.split(/[\/\-]/).map(Number);
            if (!day || !month || !year) return false;
            const date = new Date(year, month - 1, day);
            return date >= oneYearAgo;
        };

        // Global Stats Calculation
        let globalStats = {};
        let chartData = [];

        if (viewMode === 'current') {
            const free = unique.filter(t => t.properties.status === 'free').length;
            const assigned = unique.filter(t => t.properties.status === 'assigned').length;

            globalStats = {
                cards: [
                    { label: 'Total Territorios', value: total, color: 'text-gray-900' },
                    { label: 'Libres', value: free, color: 'text-green-600' },
                    { label: 'Asignados', value: assigned, color: 'text-red-600' }
                ]
            };

            chartData = [
                { name: 'Libres', value: free, color: '#22c55e' },
                { name: 'Asignados', value: assigned, color: '#ef4444' },
            ];
        } else {
            // 12 Months View
            const worked = unique.filter(isRecentlyWorked);
            const workedIds = new Set(worked.map(t => t.properties.id));

            const assigned = unique.filter(t => t.properties.status === 'assigned');
            const assignedIds = new Set(assigned.map(t => t.properties.id));

            // "Sin trabajar" = Total - (Trabajados U Asignados)
            const workedOrAssignedCount = unique.filter(t =>
                workedIds.has(t.properties.id) || assignedIds.has(t.properties.id)
            ).length;

            const notWorked = total - workedOrAssignedCount;

            globalStats = {
                cards: [
                    { label: 'Trabajados (12m)', value: worked.length, color: 'text-blue-600' },
                    { label: 'Asignados actualmente', value: assigned.length, color: 'text-red-600' },
                    { label: 'Sin trabajar', value: notWorked, color: 'text-gray-500' }
                ]
            };

            // Chart: Non-overlapping segments
            // Priority: Trabajados -> Asignados (not worked) -> Rest (Sin trabajar)
            const chartWorked = worked.length;
            const chartAssignedOnly = assigned.filter(t => !workedIds.has(t.properties.id)).length;
            const chartRest = notWorked; // Should be same as above logic

            chartData = [
                { name: 'Trabajados', value: chartWorked, color: '#2563eb' },
                { name: 'Asignados (No trab.)', value: chartAssignedOnly, color: '#ef4444' },
                { name: 'Sin trabajar', value: chartRest, color: '#9ca3af' },
            ];
        }

        // Zone Stats Calculation
        const zStats = {};
        unique.forEach(t => {
            const zone = t.properties.zone || 'Sin Zona';
            if (!zStats[zone]) {
                zStats[zone] = {
                    name: zone,
                    total: 0,
                    // Current metrics
                    free: 0,
                    assigned: 0,
                    // 12m metrics
                    worked: 0,
                    assignedCurrent: 0, // same as assigned, but kept for clarity in logic
                    workedOrAssigned: 0 // to calc notWorked
                };
            }

            const z = zStats[zone];
            z.total++;

            // Current
            if (t.properties.status === 'free') z.free++;
            if (t.properties.status === 'assigned') {
                z.assigned++;
                z.assignedCurrent++;
            }

            // 12m
            const worked = isRecentlyWorked(t);
            if (worked) z.worked++;

            if (worked || t.properties.status === 'assigned') {
                z.workedOrAssigned++;
            }
        });

        const zoneStatsArray = Object.values(zStats).sort((a, b) => a.name.localeCompare(b.name));

        return {
            uniqueTerritories: unique,
            stats: globalStats,
            chartData,
            zoneStats: zoneStatsArray
        };
    }, [territories, viewMode]);

    return (
        <div className="space-y-8 pb-8">
            {/* Header & Toggle */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-xl font-bold text-gray-900">Resumen Global</h2>
                <div className="bg-gray-100 p-1 rounded-lg flex">
                    <button
                        onClick={() => setViewMode('current')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${viewMode === 'current'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-900'
                            }`}
                    >
                        Actualmente
                    </button>
                    <button
                        onClick={() => setViewMode('12months')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${viewMode === '12months'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-500 hover:text-gray-900'
                            }`}
                    >
                        Últimos 12 meses
                    </button>
                </div>
            </div>

            {/* Global Overview */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className={`col-span-1 md:col-span-2 grid grid-cols-2 ${viewMode === 'current' ? 'md:grid-cols-3' : 'md:grid-cols-3'} gap-4`}>
                        {stats.cards.map((card, idx) => (
                            <StatCard key={idx} label={card.label} value={card.value} color={card.color} />
                        ))}
                    </div>
                    <div className="h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={chartData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {chartData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
            {/* Zone Breakdown */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h2 className="text-xl font-bold text-gray-900 mb-6">Desglose por Zonas</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {zoneStats.map((zone) => (
                        <ZoneCard key={zone.name} zone={zone} mode={viewMode} />
                    ))}
                </div>
            </div>
        </div>
    );
}

function StatCard({ label, value, color }) {
    return (
        <div className="text-center p-4 bg-gray-50 rounded-xl border border-gray-100">
            <p className="text-sm text-gray-500 mb-1">{label}</p>
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
        </div>
    );
}

function ZoneCard({ zone, mode }) {
    if (mode === 'current') {
        const coverage = Math.round((zone.assigned / zone.total) * 100);
        return (
            <div className="p-4 border border-gray-200 rounded-xl hover:border-blue-300 transition-colors bg-gray-50/50">
                <div className="flex justify-between items-start mb-3">
                    <h3 className="font-semibold text-gray-900">{zone.name}</h3>
                    <span className="text-xs font-medium bg-gray-200 text-gray-700 px-2 py-1 rounded-full">
                        {zone.total} Terr.
                    </span>
                </div>

                <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                        <span className="text-green-600 font-medium">{zone.free} Libres</span>
                        <span className="text-red-600 font-medium">{zone.assigned} Asignados</span>
                    </div>

                    <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                        <div
                            className="bg-red-500 h-2.5 rounded-full transition-all duration-500"
                            style={{ width: `${coverage}%` }}
                        ></div>
                    </div>
                    <div className="text-right">
                        <span className="text-xs text-gray-500">{coverage}% Asignado</span>
                    </div>
                </div>
            </div>
        );
    } else {
        // 12 Months View
        const notWorked = zone.total - zone.workedOrAssigned;
        const workedPct = Math.round((zone.worked / zone.total) * 100);

        return (
            <div className="p-4 border border-gray-200 rounded-xl hover:border-blue-300 transition-colors bg-gray-50/50">
                <div className="flex justify-between items-start mb-3">
                    <h3 className="font-semibold text-gray-900">{zone.name}</h3>
                    <span className="text-xs font-medium bg-gray-200 text-gray-700 px-2 py-1 rounded-full">
                        {zone.total} Terr.
                    </span>
                </div>

                <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="bg-blue-50 p-1 rounded">
                            <div className="font-bold text-blue-600">{zone.worked}</div>
                            <div className="text-gray-500">Trab.</div>
                        </div>
                        <div className="bg-red-50 p-1 rounded">
                            <div className="font-bold text-red-600">{zone.assignedCurrent}</div>
                            <div className="text-gray-500">Asig.</div>
                        </div>
                        <div className="bg-gray-100 p-1 rounded">
                            <div className="font-bold text-gray-600">{notWorked}</div>
                            <div className="text-gray-500">Resto</div>
                        </div>
                    </div>

                    <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                        <div
                            className="bg-blue-500 h-2.5 rounded-full transition-all duration-500"
                            style={{ width: `${workedPct}%` }}
                        ></div>
                    </div>
                    <div className="text-right">
                        <span className="text-xs text-gray-500">{workedPct}% Trabajado (12m)</span>
                    </div>
                </div>
            </div>
        );
    }
}

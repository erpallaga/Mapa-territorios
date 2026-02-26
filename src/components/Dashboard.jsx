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

        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const getWorkedCategory = (t) => {
            const dateStr = t.properties.lastCompletedDate;
            if (!dateStr) return null;
            const [day, month, year] = dateStr.split(/[\/\-]/).map(Number);
            if (!day || !month || !year) return null;
            const date = new Date(year, month - 1, day);
            if (date >= sixMonthsAgo) return '0-6';
            if (date >= oneYearAgo) return '6-12';
            return null;
        };

        // Global Stats Calculation
        let globalStats = {};
        let chartData = [];

        if (viewMode === 'current') {
            const free = unique.filter(t => t.properties.status === 'free').length;
            const assigned = unique.filter(t => t.properties.status === 'assigned').length;

            const freePct = total > 0 ? Math.round((free / total) * 100) : 0;
            const assignedPct = total > 0 ? Math.round((assigned / total) * 100) : 0;

            globalStats = {
                cards: [
                    { label: 'Total Territorios', value: total, color: 'text-gray-900' },
                    { label: 'Libres', value: free, color: 'text-green-600', percentage: freePct },
                    { label: 'Asignados', value: assigned, color: 'text-red-600', percentage: assignedPct }
                ]
            };

            chartData = [
                { name: `Libres (${freePct}%)`, value: free, color: '#22c55e' },
                { name: `Asignados (${assignedPct}%)`, value: assigned, color: '#ef4444' },
            ];
        } else {
            // 12 Months View - Exact 4 Categories
            const worked0to6 = [];
            const worked6to12 = [];
            const assignedNotWorked = [];
            const freeNotWorked = [];

            unique.forEach(t => {
                const cat = getWorkedCategory(t);
                if (cat === '0-6') {
                    worked0to6.push(t);
                } else if (cat === '6-12') {
                    worked6to12.push(t);
                } else if (t.properties.status === 'assigned') {
                    assignedNotWorked.push(t);
                } else {
                    freeNotWorked.push(t);
                }
            });

            const workedTotal = worked0to6.length + worked6to12.length;
            const assignedTotal = assignedNotWorked.length;
            const freeTotal = freeNotWorked.length;

            const workedPct = total > 0 ? Math.round((workedTotal / total) * 100) : 0;
            const assignedPct = total > 0 ? Math.round((assignedTotal / total) * 100) : 0;
            const freePct = total > 0 ? Math.round((freeTotal / total) * 100) : 0;

            const labelTrabajados = (
                <div className="flex flex-col items-center">
                    <span>Trabajados (12m)</span>
                    <span className="text-[10px] font-normal text-gray-400 mt-0.5">
                        (0-6m: {worked0to6.length} | 6-12m: {worked6to12.length})
                    </span>
                </div>
            );

            globalStats = {
                cards: [
                    { label: labelTrabajados, value: workedTotal, color: 'text-blue-600', percentage: workedPct },
                    { label: 'Asignados (>12m)', value: assignedTotal, color: 'text-orange-500', percentage: assignedPct },
                    { label: 'Libres (>12m o nunca)', value: freeTotal, color: 'text-red-500', percentage: freePct }
                ]
            };

            const w06Pct = total > 0 ? Math.round((worked0to6.length / total) * 100) : 0;
            const w612Pct = total > 0 ? Math.round((worked6to12.length / total) * 100) : 0;

            chartData = [
                { name: `0-6 meses (${w06Pct}%)`, value: worked0to6.length, color: '#93c5fd' },
                { name: `6-12 meses (${w612Pct}%)`, value: worked6to12.length, color: '#1e3a8a' },
                { name: `Asignados (${assignedPct}%)`, value: assignedTotal, color: '#f59e0b' },
                { name: `Libres (${freePct}%)`, value: freeTotal, color: '#ef4444' },
            ].filter(d => d.value > 0); // Hide empty segments
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
                    w06: 0,
                    w612: 0,
                    assigned12m: 0,
                    free12m: 0
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

            // 12m exact categories
            const cat = getWorkedCategory(t);
            if (cat === '0-6') {
                z.w06++;
            } else if (cat === '6-12') {
                z.w612++;
            } else if (t.properties.status === 'assigned') {
                z.assigned12m++;
            } else {
                z.free12m++;
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
                            <StatCard
                                key={idx}
                                label={card.label}
                                value={card.value}
                                color={card.color}
                                percentage={card.percentage}
                            />
                        ))}
                    </div>
                    <div className="h-[200px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={chartData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={50}
                                    outerRadius={70}
                                    paddingAngle={5}
                                    dataKey="value"
                                    label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
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

function StatCard({ label, value, color, percentage }) {
    return (
        <div className="flex flex-col items-center justify-center text-center p-4 bg-gray-50 rounded-xl border border-gray-100 h-full">
            <div className="mb-2 flex-grow flex items-end justify-center">
                <span className="text-sm text-gray-500">{label}</span>
            </div>
            <div className="flex flex-col items-center justify-start flex-grow">
                <p className={`text-3xl font-bold ${color}`}>{value}</p>
                {percentage !== undefined && (
                    <p className="text-xs text-gray-400 mt-1">{percentage}% del total</p>
                )}
            </div>
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
                        <span className="text-red-600 font-medium">{zone.assigned} Asignados</span>
                        <span className="text-green-600 font-medium">{zone.free} Libres</span>
                    </div>

                    <div className="w-full bg-green-500 rounded-full h-2.5 overflow-hidden flex">
                        <div
                            className="bg-red-500 h-2.5 transition-all duration-500"
                            style={{ width: `${coverage}%` }}
                        ></div>
                    </div>
                    <div className="text-left">
                        <span className="text-xs text-gray-500">{coverage}% Asignado</span>
                    </div>
                </div>
            </div>
        );
    } else {
        // 12 Months View
        const workedTotal = zone.w06 + zone.w612;
        const workedPct = zone.total > 0 ? Math.round((workedTotal / zone.total) * 100) : 0;

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
                        <div className="bg-blue-50 p-1 rounded flex flex-col justify-center">
                            <div className="font-bold text-blue-600">{workedTotal}</div>
                            <div className="text-[10px] text-blue-400">({zone.w06} | {zone.w612})</div>
                            <div className="text-gray-500">Trab.</div>
                        </div>
                        <div className="bg-orange-50 p-1 rounded flex flex-col justify-center">
                            <div className="font-bold text-orange-500">{zone.assigned12m}</div>
                            <div className="text-[10px] opacity-0 text-transparent">_</div>
                            <div className="text-gray-500">Asig.</div>
                        </div>
                        <div className="bg-red-50 p-1 rounded flex flex-col justify-center">
                            <div className="font-bold text-red-500">{zone.free12m}</div>
                            <div className="text-[10px] opacity-0 text-transparent">_</div>
                            <div className="text-gray-500">Libres</div>
                        </div>
                    </div>

                    <div className="w-full bg-gray-200 rounded-full h-2.5 flex overflow-hidden">
                        <div
                            className="bg-blue-300 h-2.5 transition-all duration-500"
                            style={{ width: `${zone.total > 0 ? (zone.w06 / zone.total) * 100 : 0}%` }}
                            title="0-6 meses"
                        ></div>
                        <div
                            className="bg-blue-800 h-2.5 transition-all duration-500"
                            style={{ width: `${zone.total > 0 ? (zone.w612 / zone.total) * 100 : 0}%` }}
                            title="6-12 meses"
                        ></div>
                        <div
                            className="bg-orange-500 h-2.5 transition-all duration-500"
                            style={{ width: `${zone.total > 0 ? (zone.assigned12m / zone.total) * 100 : 0}%` }}
                            title="Asignados"
                        ></div>
                        <div
                            className="bg-red-500 h-2.5 transition-all duration-500"
                            style={{ width: `${zone.total > 0 ? (zone.free12m / zone.total) * 100 : 0}%` }}
                            title="Libres"
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

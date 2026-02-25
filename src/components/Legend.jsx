import React from 'react';
import { cn } from '../lib/utils';

export function Legend({ viewMode }) {
    const items = viewMode === 'current'
        ? [
            { color: '#22c55e', label: 'Libre' },
            { color: '#ef4444', label: 'Asignado' }
        ]
        : [
            { color: '#93c5fd', label: '0-6 meses' },
            { color: '#1e3a8a', label: '6-12 meses' },
            { color: '#f59e0b', label: 'Asignado (>12m)' },
            { color: '#ef4444', label: 'Sin trabajar (>12m)' }
        ];

    return (
        <div className="absolute bottom-24 left-4 z-[1000] bg-white rounded-lg shadow-md border border-gray-200 p-3 flex flex-col gap-2 w-fit max-w-[calc(100%-2rem)] md:bottom-4 md:max-w-[200px]">
            <h4 className="text-[10px] md:text-xs font-bold text-gray-400 md:text-gray-500 uppercase tracking-wider">Leyenda</h4>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 md:flex-col md:items-start md:space-y-1.5 md:gap-x-0">
                {items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                        <div
                            className="w-3.5 h-3.5 md:w-4 md:h-4 rounded-sm border border-black/10 flex-shrink-0"
                            style={{ backgroundColor: item.color }}
                        />
                        <span className="text-[11px] md:text-xs font-medium text-gray-700 leading-none whitespace-nowrap">{item.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

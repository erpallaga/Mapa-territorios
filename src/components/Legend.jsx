import React from 'react';
import { cn } from '../lib/utils';

export function Legend({ viewMode }) {
    const items = viewMode === 'current'
        ? [
            { color: '#22c55e', label: 'Libre' },
            { color: '#ef4444', label: 'Asignado' }
        ]
        : viewMode === '12months'
            ? [
                { color: '#93c5fd', label: '0-6 meses' },
                { color: '#1e3a8a', label: '6-12 meses' },
                { color: '#f59e0b', label: 'Asignado (>12m)' },
                { color: '#ef4444', label: 'Sin trabajar (>12m)' }
            ]
            : [
                // Expired mode
                { color: '#fbbf24', label: '4-5 meses' },
                { color: '#f97316', label: '5-7 meses' },
                { color: '#ef4444', label: '7-10 meses' },
                { color: '#991b1b', label: '>10 meses' },
                { color: '#d1d5db', label: 'No caducado', opacity: 0.3 }
            ];

    return (
        <div className={cn(
            "absolute z-[1000] bg-white rounded-lg shadow-md border border-gray-200 p-3 flex flex-col gap-2 w-fit max-w-[calc(100%-2rem)]",
            // In expired mode, position above the bottom panel
            viewMode === 'expired'
                ? "bottom-[280px] left-4 md:bottom-[232px] md:max-w-[200px]"
                : "bottom-24 left-4 md:bottom-4 md:max-w-[200px]"
        )}>
            <h4 className="text-[10px] md:text-xs font-bold text-gray-400 md:text-gray-500 uppercase tracking-wider">
                {viewMode === 'expired' ? 'Caducado desde' : 'Leyenda'}
            </h4>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 md:flex-col md:items-start md:space-y-1.5 md:gap-x-0">
                {items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                        <div
                            className="w-3.5 h-3.5 md:w-4 md:h-4 rounded-sm border border-black/10 flex-shrink-0"
                            style={{
                                backgroundColor: item.color,
                                opacity: item.opacity || 1
                            }}
                        />
                        <span className="text-[11px] md:text-xs font-medium text-gray-700 leading-none whitespace-nowrap">{item.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

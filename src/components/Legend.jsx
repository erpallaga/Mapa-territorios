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
        <div className="absolute bottom-4 left-4 z-[1000] bg-white rounded-lg shadow-md border border-gray-200 p-3 flex flex-col gap-2 max-w-[200px] md:bottom-20 lg:bottom-4">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Leyenda</h4>
            <div className="space-y-1.5">
                {items.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                        <div
                            className="w-4 h-4 rounded-sm border border-black/10 flex-shrink-0"
                            style={{ backgroundColor: item.color }}
                        />
                        <span className="text-xs font-medium text-gray-700 leading-none">{item.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

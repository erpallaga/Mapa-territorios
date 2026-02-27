import React from 'react';
import { cn } from '../lib/utils';

export function Legend({ viewMode, expiredListExpanded }) {
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
                // Expired mode — days past the 4-month mark
                { color: '#fbbf24', label: '< 1 mes' },
                { color: '#f97316', label: '1-3 meses' },
                { color: '#ef4444', label: '3-6 meses' },
                { color: '#991b1b', label: '> 6 meses' },
                { color: '#9ca3af', label: 'No caducado', opacity: 0.5 }
            ];

    // Position logic:
    // - current / 12months: same as collapsed expired
    // - expired expanded: above the list (~132px) + header (~68px) + tight gap (~4px)
    // - expired collapsed: above the header (~68px) + tight gap (~4px)
    const positionClass = viewMode !== 'expired'
        ? "bottom-[68px] left-4 md:bottom-4 md:max-w-[200px]"
        : expiredListExpanded
            ? "bottom-[200px] left-4 md:bottom-[232px] md:max-w-[200px]"
            : "bottom-[68px] left-4 md:bottom-[56px] md:max-w-[200px]";

    return (
        <div className={cn(
            "absolute z-[1000] bg-white rounded-lg shadow-md border border-gray-200 p-3 flex flex-col gap-2 w-fit max-w-[calc(100%-2rem)]",
            positionClass
        )}>
            <h4 className="text-[10px] md:text-xs font-bold text-gray-400 md:text-gray-500 uppercase tracking-wider">
                {viewMode === 'expired' ? 'Caducado hace' : 'Leyenda'}
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

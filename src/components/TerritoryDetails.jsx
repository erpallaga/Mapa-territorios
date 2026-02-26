import React from 'react';
import { X, Calendar, User, MapPin, Hash, History } from 'lucide-react';
import { cn } from '../lib/utils';

export function TerritoryDetails({ territory, onClose, isOpen }) {
    if (!territory) return null;

    return (
        <div
            className={cn(
                "fixed inset-y-0 right-0 w-full sm:w-96 bg-white shadow-2xl transform transition-transform duration-300 ease-in-out z-[1000]",
                isOpen ? "translate-x-0" : "translate-x-full"
            )}
        >
            <div className="h-full flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex justify-between items-start bg-gray-50">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Hash className="w-5 h-5 text-gray-400" />
                            Territorio {territory.id || territory.name}
                        </h2>
                        <p className="text-gray-500 mt-1 flex items-center gap-1">
                            <MapPin className="w-4 h-4" />
                            {territory.zone || 'Sin zona especificada'}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                    >
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Status Badge */}
                    <div className={cn(
                        "inline-flex items-center px-3 py-1 rounded-full text-sm font-medium",
                        territory.status === 'free'
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                    )}>
                        {territory.status === 'free' ? 'Libre' : 'Asignado'}
                    </div>

                    {/* Details Grid */}
                    <div className="space-y-4">
                        <DetailRow
                            icon={<User className="w-5 h-5 text-gray-400" />}
                            label="Publicador Asignado"
                            value={territory.status === 'free' ? '-' : (territory.publisher || '-')}
                        />
                        <DetailRow
                            icon={<Calendar className="w-5 h-5 text-gray-400" />}
                            label="Fecha de Inicio"
                            value={territory.status === 'free' ? '-' : (territory.assignedDate || '-')}
                        />
                        <DetailRow
                            icon={<Calendar className="w-5 h-5 text-gray-400" />}
                            label="Última fecha en que se completó"
                            value={territory.lastCompletedDate || '-'}
                        />
                        <DetailRow
                            icon={<History className="w-5 h-5 text-gray-400" />}
                            label="Veces trabajado (12 meses)"
                            value={territory.completionCount12m || 0}
                        />
                    </div>

                    {/* History Section */}
                    <div className="pt-6 border-t border-gray-100">
                        <h3 className="text-sm font-semibold text-gray-900 mb-4">Histórico de asignaciones</h3>
                        {territory.history && territory.history.length > 0 ? (
                            <div className="space-y-4">
                                {territory.history.map((record, idx) => (
                                    <div key={idx} className="flex items-start gap-3 bg-white p-3 rounded-lg border border-gray-100 shadow-sm">
                                        <User className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium text-gray-900 truncate">
                                                {record.publisher}
                                            </p>
                                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                                                <span className="flex items-center gap-1">
                                                    <Calendar className="w-3 h-3" />
                                                    <span>Desde: {record.assignedDate || '-'}</span>
                                                </span>
                                                <span className="flex items-center gap-1">
                                                    <Calendar className="w-3 h-3" />
                                                    <span>Hasta: {record.completedDate || '-'}</span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-sm text-gray-500 italic">
                                No hay datos históricos disponibles.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function DetailRow({ icon, label, value }) {
    return (
        <div className="flex items-start gap-3">
            <div className="mt-0.5">{icon}</div>
            <div>
                <p className="text-sm font-medium text-gray-500">{label}</p>
                <p className="text-base text-gray-900 font-medium">{value}</p>
            </div>
        </div>
    );
}

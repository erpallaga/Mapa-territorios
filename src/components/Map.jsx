import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '../lib/utils';
import { calculateBounds, calculateFeatureCentroid } from '../lib/territories';
import { Legend } from './Legend';

// Fix for default Leaflet icon issues in React
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

function MapController({ bounds, flyTo }) {
    const map = useMap();
    useEffect(() => {
        if (bounds) {
            map.fitBounds(bounds, { padding: [20, 20] });
        }
    }, [bounds, map]);

    useEffect(() => {
        if (flyTo) {
            map.flyTo(flyTo, 16, { duration: 0.8 });
        }
    }, [flyTo, map]);

    return null;
}

// Color helpers for expired mode
// expiredDays = days PAST the 4-month threshold
function getExpiredColor(expiredDays) {
    if (expiredDays < 30) return '#fbbf24';   // Amber-400 (0-1 month past)
    if (expiredDays < 90) return '#f97316';   // Orange-500 (1-3 months past)
    if (expiredDays < 180) return '#ef4444';  // Red-500 (3-6 months past)
    return '#991b1b';                          // Red-900 (6+ months past)
}

function getExpiredColorDot(expiredDays) {
    if (expiredDays < 30) return '🟡';
    if (expiredDays < 90) return '🟠';
    return '🔴';
}

export function Map({ territories, onTerritoryClick, selectedTerritory }) {
    const [mapBounds, setMapBounds] = useState(null);
    const [viewMode, setViewMode] = useState('current'); // 'current' | '12months' | 'expired'
    const [flyToPos, setFlyToPos] = useState(null);
    const [highlightedId, setHighlightedId] = useState(null);
    const [expiredListExpanded, setExpiredListExpanded] = useState(true);
    const geoJsonRef = useRef(null);

    // Filter out Point features to avoid duplicate markers and badges
    const filteredTerritories = useMemo(() => {
        if (!territories) return null;
        return {
            ...territories,
            features: territories.features.filter(f =>
                f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'
            )
        };
    }, [territories]);

    // Compute expired territories list (sorted by days desc)
    const expiredTerritories = useMemo(() => {
        if (!filteredTerritories) return [];
        return filteredTerritories.features
            .filter(f => f.properties.isExpired)
            .sort((a, b) => b.properties.expiredDays - a.properties.expiredDays);
    }, [filteredTerritories]);

    useEffect(() => {
        if (filteredTerritories) {
            const bounds = calculateBounds(filteredTerritories);
            if (bounds) {
                setMapBounds(bounds);
            }
        }
    }, [filteredTerritories]);

    // Helper to calculate months since last worked
    const getMonthsSinceWorked = (dateStr) => {
        if (!dateStr) return Infinity;
        const [day, month, year] = dateStr.split(/[\/\-]/).map(Number);
        if (!day || !month || !year) return Infinity;

        const lastWorked = new Date(year, month - 1, day);
        const now = new Date();

        const diffTime = Math.abs(now - lastWorked);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const diffMonths = diffDays / 30.44;

        return diffMonths;
    };

    // Helper to get color for history view
    const getColorForHistory = (months, status) => {
        if (months > 12) {
            if (status === 'assigned') {
                return '#f59e0b';
            }
            return '#ef4444';
        }

        if (months <= 3) return '#93c5fd';
        if (months <= 6) return '#3b82f6';
        if (months <= 9) return '#1d4ed8';
        return '#1e3a8a';
    };

    // Style function for polygons
    const style = (feature) => {
        const status = feature?.properties?.status;
        const lastCompletedDate = feature?.properties?.lastCompletedDate;
        const featureId = feature?.properties?.id;

        let fillColor = '#9ca3af';
        let fillOpacity = 0.6;
        let weight = 2;
        let color = 'white';
        let dashArray = '3';

        if (viewMode === 'current') {
            fillColor = status === 'free' ? '#22c55e' : '#ef4444';
        } else if (viewMode === '12months') {
            const months = getMonthsSinceWorked(lastCompletedDate);
            fillColor = getColorForHistory(months, status);
            if (months > 12) {
                fillOpacity = 0.7;
            }
        } else if (viewMode === 'expired') {
            const isExpired = feature?.properties?.isExpired;
            const expiredDays = feature?.properties?.expiredDays || 0;

            if (isExpired) {
                fillColor = getExpiredColor(expiredDays);
                fillOpacity = 0.75;
            } else {
                // Fix #3: more visible non-expired territories
                fillColor = '#9ca3af'; // Gray-400
                fillOpacity = 0.35;
            }

            // Fix #5: highlight selected territory from list
            if (highlightedId && featureId === highlightedId) {
                weight = 5;
                color = '#1e40af'; // Blue-800 bold border
                dashArray = '';
                fillOpacity = 0.85;
            }
        }

        return {
            fillColor,
            weight,
            opacity: 1,
            color,
            dashArray,
            fillOpacity
        };
    };

    // Highlight on hover + click behavior
    const onEachFeature = (feature, layer) => {
        // In expired mode, bind a Leaflet popup for expired territories
        if (viewMode === 'expired' && feature?.properties?.isExpired) {
            const props = feature.properties;
            const days = props.expiredDays;
            const dot = getExpiredColorDot(days);
            layer.bindPopup(
                `<div style="font-family: system-ui, sans-serif; min-width: 160px;">
                    <div style="font-size: 16px; font-weight: 700; margin-bottom: 6px;">
                        Territorio ${props.id || props.name} ${dot}
                    </div>
                    <div style="font-size: 13px; color: #555; margin-bottom: 3px;">
                        <strong>Publicador:</strong> ${props.publisher || '-'}
                    </div>
                    <div style="font-size: 13px; color: #555; margin-bottom: 3px;">
                        <strong>Asignado:</strong> ${props.assignedDate || '-'}
                    </div>
                    <div style="font-size: 14px; font-weight: 600; color: ${getExpiredColor(days)}; margin-top: 6px;">
                        ⏰ ${days} días caducado
                    </div>
                </div>`,
                { className: 'expired-popup' }
            );
        }

        layer.on({
            mouseover: (e) => {
                const layer = e.target;
                if (viewMode === 'expired' && !feature?.properties?.isExpired) return;
                layer.setStyle({
                    weight: 4,
                    color: '#666',
                    dashArray: '',
                    fillOpacity: 0.8
                });
                layer.bringToFront();
            },
            mouseout: (e) => {
                const layer = e.target;
                layer.setStyle(style(feature));
            },
            click: () => {
                if (viewMode === 'expired') return;
                onTerritoryClick(feature?.properties);
            }
        });
    };

    // Calculate markers for badges
    const badgeMarkers = useMemo(() => {
        if (!filteredTerritories) return [];

        if (viewMode === '12months') {
            return filteredTerritories.features.map(feature => {
                const center = calculateFeatureCentroid(feature);
                if (!center) return null;
                const count = feature.properties.completionCount12m || 0;
                return { position: center, label: String(count), id: feature.properties.id };
            }).filter(Boolean);
        }

        if (viewMode === 'expired') {
            return filteredTerritories.features
                .filter(f => f.properties.isExpired)
                .map(feature => {
                    const center = calculateFeatureCentroid(feature);
                    if (!center) return null;
                    const days = feature.properties.expiredDays;
                    return { position: center, label: `${days}d`, id: feature.properties.id };
                }).filter(Boolean);
        }

        return [];
    }, [filteredTerritories, viewMode]);

    const createBadgeIcon = (label) => {
        const isExpiredBadge = viewMode === 'expired';
        const bgColor = isExpiredBadge ? '#fef3c7' : 'white';
        const borderColor = isExpiredBadge ? '#d97706' : '#4b5563';
        const textColor = isExpiredBadge ? '#92400e' : '#111827';
        const fontSize = isExpiredBadge ? '9px' : '11px';
        const size = isExpiredBadge ? 32 : 24;

        return L.divIcon({
            className: 'custom-badge-icon',
            html: `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size - 6}px;background:${bgColor};border-radius:9999px;border:2px solid ${borderColor};box-shadow:0 1px 2px rgba(0,0,0,0.15);font-size:${fontSize};font-weight:700;color:${textColor};line-height:1;">${label}</div>`,
            iconSize: [size, size - 6],
            iconAnchor: [size / 2, (size - 6) / 2]
        });
    };

    // Fly to + highlight a territory from the expired list
    const handleFlyToTerritory = useCallback((feature) => {
        const center = calculateFeatureCentroid(feature);
        const id = feature.properties.id;

        if (center) {
            setFlyToPos(center);
            setHighlightedId(id);
            setTimeout(() => setFlyToPos(null), 1000);

            // Update GeoJSON styles to show highlight
            if (geoJsonRef.current) {
                geoJsonRef.current.eachLayer((layer) => {
                    if (layer.feature) {
                        layer.setStyle(
                            layer.feature.properties.id === id
                                ? { weight: 5, color: '#1e40af', dashArray: '', fillOpacity: 0.85 }
                                : style(layer.feature)
                        );
                        if (layer.feature.properties.id === id) {
                            layer.bringToFront();
                            // Open popup if it has one
                            if (layer.getPopup()) {
                                setTimeout(() => layer.openPopup(), 900);
                            }
                        }
                    }
                });
            }
        }
    }, [viewMode, highlightedId]);

    return (
        <div className="h-full w-full relative z-0">
            {/* Toggle Control */}
            <div className={cn(
                "absolute top-[8px] md:top-4 right-4 z-[1000] bg-white rounded-lg shadow-md border border-gray-200 p-1 flex transition-all duration-300",
                selectedTerritory && viewMode !== 'expired' && "sm:mr-96"
            )}>
                <button
                    onClick={() => setViewMode('current')}
                    className={cn(
                        "px-2.5 py-1.5 text-[11px] sm:text-xs font-medium rounded-md transition-colors",
                        viewMode === 'current'
                            ? "bg-gray-900 text-white shadow-sm"
                            : "text-gray-600 hover:bg-gray-100"
                    )}
                >
                    Actual
                </button>
                <button
                    onClick={() => setViewMode('12months')}
                    className={cn(
                        "px-2.5 py-1.5 text-[11px] sm:text-xs font-medium rounded-md transition-colors",
                        viewMode === '12months'
                            ? "bg-gray-900 text-white shadow-sm"
                            : "text-gray-600 hover:bg-gray-100"
                    )}
                >
                    12 meses
                </button>
                <button
                    onClick={() => setViewMode('expired')}
                    className={cn(
                        "px-2.5 py-1.5 text-[11px] sm:text-xs font-medium rounded-md transition-colors",
                        viewMode === 'expired'
                            ? "bg-amber-600 text-white shadow-sm"
                            : "text-gray-600 hover:bg-gray-100"
                    )}
                >
                    ⏰ Caducados
                </button>
            </div>

            <MapContainer
                center={[40.416775, -3.703790]}
                zoom={13}
                scrollWheelZoom={true}
                className="h-full w-full"
                style={{ background: '#f0f0f0' }}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {filteredTerritories && (
                    <GeoJSON
                        key={viewMode}
                        data={filteredTerritories}
                        style={style}
                        onEachFeature={onEachFeature}
                        ref={geoJsonRef}
                    />
                )}

                {/* Render Badges */}
                {(viewMode === '12months' || viewMode === 'expired') && badgeMarkers.map((marker) => (
                    <Marker
                        key={`${viewMode}-${marker.id}`}
                        position={marker.position}
                        icon={createBadgeIcon(marker.label)}
                        interactive={false}
                    />
                ))}

                <MapController bounds={mapBounds} flyTo={flyToPos} />
            </MapContainer>

            {/* Map Legend */}
            <Legend viewMode={viewMode} expiredListExpanded={expiredListExpanded} />

            {/* Expired List Panel */}
            {viewMode === 'expired' && (
                <ExpiredListPanel
                    territories={expiredTerritories}
                    onItemClick={handleFlyToTerritory}
                    highlightedId={highlightedId}
                    expanded={expiredListExpanded}
                    onToggleExpand={() => setExpiredListExpanded(!expiredListExpanded)}
                />
            )}
        </div>
    );
}

// ─── Expired List Panel (Bottom Sheet) ──────────────────────────────────────

function ExpiredListPanel({ territories, onItemClick, highlightedId, expanded, onToggleExpand }) {
    const count = territories.length;

    if (count === 0) return null;

    return (
        <div
            className={cn(
                "absolute left-0 right-0 z-[1000] bg-white border-t border-gray-200 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] transition-all duration-300 ease-in-out",
                // Fixed at bottom to avoid showing map underneath; taller header for touch safety
                "bottom-0",
                expanded
                    ? "max-h-[50vh] md:max-h-[220px]"
                    : "max-h-[44px] md:max-h-[44px]"
            )}
        >
            {/* Header / Toggle */}
            <button
                onClick={onToggleExpand}
                className="w-full flex items-center justify-between px-4 pt-3 pb-8 md:py-2.5 border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer select-none"
            >
                <div className="flex items-center gap-2">
                    <span className="text-amber-600 text-sm">⏰</span>
                    <span className="text-sm font-semibold text-gray-900">
                        {count} territorio{count !== 1 ? 's' : ''} caducado{count !== 1 ? 's' : ''}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 hidden sm:inline">
                        {expanded ? 'Contraer' : 'Expandir'}
                    </span>
                    <svg
                        className={cn(
                            "w-4 h-4 text-gray-400 transition-transform duration-200",
                            expanded ? "rotate-180" : ""
                        )}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                </div>
            </button>

            {/* List — controlled by expanded state on ALL screen sizes */}
            <div
                className={cn(
                    "overflow-y-auto transition-all duration-300",
                    expanded
                        ? "max-h-[132px] md:max-h-[176px]"
                        : "max-h-0"
                )}
            >
                {territories.map((feature) => {
                    const props = feature.properties;
                    const days = props.expiredDays;
                    const dot = getExpiredColorDot(days);
                    const isHighlighted = highlightedId === props.id;

                    return (
                        <button
                            key={props.id}
                            onClick={() => onItemClick(feature)}
                            className={cn(
                                "w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left border-b border-gray-50 last:border-0 cursor-pointer",
                                isHighlighted
                                    ? "bg-amber-100 border-l-4 border-l-amber-500"
                                    : "hover:bg-amber-50"
                            )}
                        >
                            <span className="text-sm font-bold text-gray-700 w-10 shrink-0">
                                #{props.id}
                            </span>
                            <span className="text-sm text-gray-600 flex-1 truncate">
                                {props.publisher || '-'}
                            </span>
                            <span className="text-xs font-semibold whitespace-nowrap" style={{ color: getExpiredColor(days) }}>
                                {days} días
                            </span>
                            <span className="text-sm">{dot}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

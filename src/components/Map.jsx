import React, { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap, Marker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '../lib/utils';
import { calculateBounds, calculateFeatureCentroid } from '../lib/territories';

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

function MapController({ bounds }) {
    const map = useMap();
    useEffect(() => {
        if (bounds) {
            map.fitBounds(bounds, { padding: [20, 20] });
        }
    }, [bounds, map]);
    return null;
}

export function Map({ territories, onTerritoryClick, selectedTerritory }) {
    const [mapBounds, setMapBounds] = useState(null);
    const [viewMode, setViewMode] = useState('current'); // 'current' | '12months'

    // Filter out Point features to avoid duplicate markers and badges
    // We only want to render Polygons and calculate badges for them
    const filteredTerritories = useMemo(() => {
        if (!territories) return null;
        return {
            ...territories,
            features: territories.features.filter(f =>
                f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'
            )
        };
    }, [territories]);

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

        // Calculate difference in months
        const diffTime = Math.abs(now - lastWorked);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        const diffMonths = diffDays / 30.44; // Average days in month

        return diffMonths;
    };

    // Helper to get color for history view
    const getColorForHistory = (months, status) => {
        // If not worked in last 12 months (months > 12)
        if (months > 12) {
            if (status === 'assigned') {
                return '#f59e0b'; // Amber-500 for Assigned (but not worked recently)
            }
            return '#ef4444'; // Red-500 for Free (and not worked recently) - CRITICAL
        }

        // Gradient from Light Blue (recent) to Dark Blue (old)
        // Using more distinct steps to differentiate the 4 quarters
        if (months <= 3) return '#93c5fd'; // Blue-300 (Very Recent)
        if (months <= 6) return '#3b82f6'; // Blue-500 (Recent)
        if (months <= 9) return '#1d4ed8'; // Blue-700 (Older)
        return '#1e3a8a'; // Blue-900 (Oldest within year)
    };

    // Style function for polygons
    const style = (feature) => {
        const status = feature?.properties?.status;
        const lastCompletedDate = feature?.properties?.lastCompletedDate;

        let fillColor = '#9ca3af'; // Default gray
        let fillOpacity = 0.6;

        if (viewMode === 'current') {
            fillColor = status === 'free' ? '#22c55e' : '#ef4444'; // Green-500 : Red-500
        } else {
            // 12 Months View
            const months = getMonthsSinceWorked(lastCompletedDate);
            fillColor = getColorForHistory(months, status);

            // Adjust opacity for unworked territories to make them distinct but not overwhelming
            if (months > 12) {
                fillOpacity = 0.7;
            }
        }

        return {
            fillColor,
            weight: 2,
            opacity: 1,
            color: 'white',
            dashArray: '3',
            fillOpacity
        };
    };

    // Highlight on hover
    const onEachFeature = (feature, layer) => {
        layer.on({
            mouseover: (e) => {
                const layer = e.target;
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
                // Reset style
                layer.setStyle(style(feature));
            },
            click: () => {
                onTerritoryClick(feature?.properties);
            }
        });
    };

    // Calculate markers for badges
    const badgeMarkers = useMemo(() => {
        if (viewMode !== '12months' || !filteredTerritories) return [];

        return filteredTerritories.features.map(feature => {
            const center = calculateFeatureCentroid(feature);
            if (!center) return null;

            const count = feature.properties.completionCount12m || 0;

            return {
                position: center,
                count: count,
                id: feature.properties.id
            };
        }).filter(Boolean);
    }, [filteredTerritories, viewMode]);

    const createBadgeIcon = (count) => {
        return L.divIcon({
            className: 'custom-badge-icon',
            html: `<div class="flex items-center justify-center w-6 h-6 bg-white rounded-full border-2 border-gray-600 shadow-sm text-xs font-bold text-gray-900">${count}</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
    };

    return (
        <div className="h-full w-full relative z-0">
            {/* Toggle Control */}
            <div className="absolute top-4 right-4 z-[1000] bg-white rounded-lg shadow-md border border-gray-200 p-1 flex">
                <button
                    onClick={() => setViewMode('current')}
                    className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                        viewMode === 'current'
                            ? "bg-gray-900 text-white shadow-sm"
                            : "text-gray-600 hover:bg-gray-100"
                    )}
                >
                    Actualmente
                </button>
                <button
                    onClick={() => setViewMode('12months')}
                    className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                        viewMode === '12months'
                            ? "bg-gray-900 text-white shadow-sm"
                            : "text-gray-600 hover:bg-gray-100"
                    )}
                >
                    Últimos 12 meses
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
                        key={viewMode} // Force re-render when view mode changes to update styles immediately
                        data={filteredTerritories}
                        style={style}
                        onEachFeature={onEachFeature}
                    />
                )}

                {/* Render Badges */}
                {viewMode === '12months' && badgeMarkers.map((marker) => (
                    <Marker
                        key={marker.id}
                        position={marker.position}
                        icon={createBadgeIcon(marker.count)}
                        interactive={false} // Allow clicking through to the polygon
                    />
                ))}

                <MapController bounds={mapBounds} />
            </MapContainer>
        </div>
    );
}

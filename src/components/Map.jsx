import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '../lib/utils';
import { calculateBounds } from '../lib/territories';

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

    useEffect(() => {
        if (territories) {
            const bounds = calculateBounds(territories);
            if (bounds) {
                setMapBounds(bounds);
            }
        }
    }, [territories]);

    // Style function for polygons
    const style = (feature) => {
        const status = feature?.properties?.status;
        return {
            fillColor: status === 'free' ? '#22c55e' : '#ef4444', // Green-500 : Red-500
            weight: 2,
            opacity: 1,
            color: 'white',
            dashArray: '3',
            fillOpacity: 0.6
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

    return (
        <div className="h-full w-full relative z-0">
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
                {territories && (
                    <GeoJSON
                        data={territories}
                        style={style}
                        onEachFeature={onEachFeature}
                    />
                )}
                <MapController bounds={mapBounds} />
            </MapContainer>
        </div>
    );
}

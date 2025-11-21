/**
 * Merges GeoJSON features with territory data from Google Sheets.
 * @param {Object} geoJson - The GeoJSON object containing territory polygons.
 * @param {Array} sheetData - Array of territory data objects from the sheet.
 * @returns {Object} - New GeoJSON object with merged properties.
 */
export function mergeTerritoryData(geoJson, sheetData) {
    if (!geoJson || !sheetData) return geoJson;

    const mergedFeatures = geoJson.features.map(feature => {
        // Try to match by name first
        let territoryId = feature.properties.name;

        // If name doesn't look like an ID, try extracting from sourceFile
        // Example: "TERRITORIO 1.kml" -> "1"
        if (feature.properties.sourceFile) {
            const match = feature.properties.sourceFile.match(/TERRITORIO\s+(\d+)\.kml/i);
            if (match) {
                territoryId = match[1];
            }
        }

        const data = sheetData.find(row => row.id === territoryId);

        if (data) {
            return {
                ...feature,
                properties: {
                    ...feature.properties,
                    ...data, // Merge sheet data into properties
                    status: data.status // Already normalized in sheets.js
                }
            };
        }
        return feature;
    });

    return {
        ...geoJson,
        features: mergedFeatures
    };
}

/**
 * Calculates the bounding box of a GeoJSON object.
 * @param {Object} geoJson - The GeoJSON object.
 * @returns {Array} - The [[minLat, minLng], [maxLat, maxLng]] bounds.
 */
export function calculateBounds(geoJson) {
    if (!geoJson || !geoJson.features || geoJson.features.length === 0) {
        return null;
    }

    let minLat = 90;
    let maxLat = -90;
    let minLng = 180;
    let maxLng = -180;
    let hasCoordinates = false;

    geoJson.features.forEach(feature => {
        if (!feature.geometry || !feature.geometry.coordinates) return;

        const type = feature.geometry.type;
        const coordinates = feature.geometry.coordinates;

        if (type === 'Point') {
            const [lng, lat] = coordinates;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            hasCoordinates = true;
        } else if (type === 'Polygon') {
            // Polygon: [ [ [lng, lat], ... ], ... ]
            // Outer ring is at index 0
            coordinates[0].forEach(coord => {
                const [lng, lat] = coord;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
                hasCoordinates = true;
            });
        } else if (type === 'MultiPolygon') {
            // MultiPolygon: [ [ [ [lng, lat], ... ], ... ], ... ]
            coordinates.forEach(polygon => {
                polygon[0].forEach(coord => {
                    const [lng, lat] = coord;
                    if (lat < minLat) minLat = lat;
                    if (lat > maxLat) maxLat = lat;
                    if (lng < minLng) minLng = lng;
                    if (lng > maxLng) maxLng = lng;
                    hasCoordinates = true;
                });
            });
        }
    });

    if (!hasCoordinates) return null;

    return [[minLat, minLng], [maxLat, maxLng]];
}

/**
 * Calculates the centroid of a GeoJSON object.
 * @param {Object} geoJson - The GeoJSON object.
 * @returns {Array} - The [lat, lng] of the centroid.
 */
export function calculateCentroid(geoJson) {
    const bounds = calculateBounds(geoJson);
    if (!bounds) return null;

    const [[minLat, minLng], [maxLat, maxLng]] = bounds;
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;

    return [centerLat, centerLng];
}

/**
 * Calculates the centroid of a single feature.
 * @param {Object} feature - The GeoJSON feature.
 * @returns {Array} - The [lat, lng] of the centroid.
 */
export function calculateFeatureCentroid(feature) {
    if (!feature || !feature.geometry) return null;

    // Wrap feature in a GeoJSON structure to reuse calculateBounds
    const bounds = calculateBounds({ features: [feature] });
    if (!bounds) return null;

    const [[minLat, minLng], [maxLat, maxLng]] = bounds;
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;

    return [centerLat, centerLng];
}

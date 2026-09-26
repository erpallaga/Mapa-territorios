import fs from 'fs';
import path from 'path';
import { kml } from '@tmcw/togeojson';
import { DOMParser } from 'xmldom';

const kmlDirectory = 'kmlfiles';
const outputPath = 'public/data/territories.json';

// Ensure output directory exists
const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

/**
 * Quita la altitud (Google My Maps exporta siempre 0) y redondea a 6 decimales
 * (~11 cm), muy por debajo de lo que se distingue en el mapa. Reduce el JSON a
 * menos de la mitad sin cambiar nada visible.
 */
function compactCoords(coords) {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === 'number') {
        return [Number(coords[0].toFixed(6)), Number(coords[1].toFixed(6))];
    }
    return coords.map(compactCoords);
}

// Initialize FeatureCollection
const featureCollection = {
    type: 'FeatureCollection',
    features: []
};

// Read all files in the KML directory
try {
    if (!fs.existsSync(kmlDirectory)) {
        console.error(`Directory ${kmlDirectory} does not exist.`);
        process.exit(1);
    }

    // Orden natural ("TERRITORIO 2" antes que "TERRITORIO 10"). `readdirSync`
    // no garantiza orden, y un orden distinto en cada máquina regeneraba el
    // JSON con un diff enorme sin ningún cambio real.
    const files = fs.readdirSync(kmlDirectory)
        .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    const kmlFiles = files.filter(file => path.extname(file).toLowerCase() === '.kml');

    if (kmlFiles.length === 0) {
        console.log('No KML files found in the directory.');
    } else {
        console.log(`Found ${kmlFiles.length} KML files. Processing...`);

        kmlFiles.forEach(file => {
            const filePath = path.join(kmlDirectory, file);
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const kmlDom = new DOMParser().parseFromString(content);
                const geoJson = kml(kmlDom);

                if (geoJson.features) {
                    // Add sourceFile property to each feature
                    geoJson.features.forEach(feature => {
                        if (!feature.properties) {
                            feature.properties = {};
                        }
                        feature.properties.sourceFile = file;
                        if (feature.geometry) {
                            feature.geometry.coordinates = compactCoords(feature.geometry.coordinates);
                        }
                    });
                    featureCollection.features.push(...geoJson.features);
                }
            } catch (err) {
                console.error(`Error processing ${file}:`, err);
            }
        });

        // Write the merged FeatureCollection to the output file
        // Sin indentar: el fichero lo descarga cada usuario al abrir la app.
        fs.writeFileSync(outputPath, JSON.stringify(featureCollection));
        console.log(`Successfully imported ${featureCollection.features.length} features from ${kmlFiles.length} files to ${outputPath}`);
    }

} catch (err) {
    console.error('Error reading KML directory:', err);
    process.exit(1);
}

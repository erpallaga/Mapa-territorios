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

    const files = fs.readdirSync(kmlDirectory);
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
                    });
                    featureCollection.features.push(...geoJson.features);
                }
            } catch (err) {
                console.error(`Error processing ${file}:`, err);
            }
        });

        // Write the merged FeatureCollection to the output file
        fs.writeFileSync(outputPath, JSON.stringify(featureCollection, null, 2));
        console.log(`Successfully imported ${featureCollection.features.length} features from ${kmlFiles.length} files to ${outputPath}`);
    }

} catch (err) {
    console.error('Error reading KML directory:', err);
    process.exit(1);
}

import fs from 'fs';
import path from 'path';
import { kml } from '@tmcw/togeojson';
import { DOMParser } from 'xmldom';

const inputDir = process.argv[2];
const outputPath = process.argv[3] || 'public/data/territories.json';

if (!inputDir) {
    console.error('Please provide an input directory path.');
    process.exit(1);
}

const files = fs.readdirSync(inputDir).filter(file => file.endsWith('.kml'));

if (files.length === 0) {
    console.error('No KML files found in the directory.');
    process.exit(1);
}

const features = [];

files.forEach(file => {
    const filePath = path.join(inputDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const kmlDom = new DOMParser().parseFromString(content);
    const geoJson = kml(kmlDom);

    if (geoJson.features) {
        // Add filename as a property for debugging/reference if needed
        // and try to extract a name if missing
        geoJson.features.forEach(f => {
            if (!f.properties) f.properties = {};
            f.properties.sourceFile = file;
            // If name is missing, try to use filename (e.g. "TERRITORIO 1.kml" -> "1")
            if (!f.properties.name) {
                const match = file.match(/TERRITORIO\s+(\d+)/i);
                if (match) {
                    f.properties.name = match[1];
                } else {
                    f.properties.name = file.replace('.kml', '');
                }
            }
        });
        features.push(...geoJson.features);
    }
});

const finalCollection = {
    type: "FeatureCollection",
    features: features
};

// Ensure directory exists
const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(outputPath, JSON.stringify(finalCollection, null, 2));
console.log(`Merged ${files.length} KML files into ${outputPath}`);

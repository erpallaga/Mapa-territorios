import fs from 'fs';
import path from 'path';
import { kml } from '@tmcw/togeojson';
import { DOMParser } from 'xmldom';

const inputPath = process.argv[2];
const outputPath = process.argv[3] || 'public/data/territories.json';

if (!inputPath) {
    console.error('Please provide an input KML file path.');
    process.exit(1);
}

const kmlContent = fs.readFileSync(inputPath, 'utf8');
const kmlDom = new DOMParser().parseFromString(kmlContent);
const geoJson = kml(kmlDom);

// Ensure directory exists
const dir = path.dirname(outputPath);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(outputPath, JSON.stringify(geoJson, null, 2));
console.log(`Converted ${inputPath} to ${outputPath}`);

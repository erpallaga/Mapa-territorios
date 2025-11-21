import fs from 'fs';
import Papa from 'papaparse';

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQugwzM2d854XUSxfQBG-UXngD8bhKp-Tt72E_BEgeS80PtoQXNQg0YTFOt70iNE3s3sr2b6NSOfZoo/pub?output=csv';
const GEOJSON_PATH = './public/data/territories.json';

async function debugData() {
    console.log('Fetching Sheet Data...');
    const response = await fetch(SHEET_URL);
    const csvText = await response.text();

    const sheetData = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true
    }).data;

    console.log(`Sheet Data Rows: ${sheetData.length}`);
    if (sheetData.length > 0) {
        console.log('Sample Sheet Row:', sheetData[0]);
    }

    console.log('\nReading GeoJSON...');
    const geoJsonRaw = fs.readFileSync(GEOJSON_PATH, 'utf-8');
    const geoJson = JSON.parse(geoJsonRaw);
    console.log(`GeoJSON Features: ${geoJson.features.length}`);

    console.log('\nAnalyzing IDs...');
    const sheetIds = new Set(sheetData.map(r => r['Núm. de terr.']));
    const geoIds = new Set();

    geoJson.features.forEach(f => {
        let id = f.properties.name;
        if (f.properties.sourceFile) {
            const match = f.properties.sourceFile.match(/TERRITORIO\s+(\d+)\.kml/i);
            if (match) id = match[1];
        }
        geoIds.add(id);
    });

    console.log(`IDs in Sheet (${sheetIds.size}):`, [...sheetIds].sort());
    console.log(`IDs in GeoJSON (${geoIds.size}):`, [...geoIds].sort());

    const inSheetOnly = [...sheetIds].filter(id => !geoIds.has(id));
    const inGeoOnly = [...geoIds].filter(id => !sheetIds.has(id));

    console.log(`IDs in Sheet only:`, inSheetOnly);
    console.log(`IDs in GeoJSON only:`, inGeoOnly);

    console.log('\nAnalyzing Status...');
    const freeCount = sheetData.filter(r => r['Estado'] === 'Libre').length;
    const assignedCount = sheetData.filter(r => r['Estado'] !== 'Libre').length;
    console.log(`Sheet Status - Free: ${freeCount}, Assigned/Other: ${assignedCount}`);

    console.log('\nAnalyzing Dates...');
    sheetData.forEach(r => {
        const completedDate = r['Última fecha en que se completó*'];
        if (completedDate) {
            console.log(`Territory ${r['Núm. de terr.']} completed on: ${completedDate}`);
        }
    });
}

debugData().catch(console.error);

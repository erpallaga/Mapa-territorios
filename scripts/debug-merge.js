import { mergeTerritoryData } from '../src/lib/territories.js';

const mockGeoJson = {
    features: [
        {
            type: "Feature",
            properties: {
                name: "ZONA DE SANTS",
                sourceFile: "TERRITORIO 1.kml"
            }
        },
        {
            type: "Feature",
            properties: {
                name: "COMO LLEGAR",
                sourceFile: "TERRITORIO 2.kml"
            }
        }
    ]
};

const mockSheetData = [
    { id: "1", status: "free", publisher: "John Doe" },
    { id: "2", status: "assigned", publisher: "Jane Doe" }
];

console.log("--- Original Merge Logic ---");
const merged = mergeTerritoryData(mockGeoJson, mockSheetData);
merged.features.forEach(f => {
    console.log(`Feature: ${f.properties.sourceFile}, ID found: ${f.properties.id}, Status: ${f.properties.status}`);
});

console.log("\n--- Proposed Logic Test ---");
const fixedFeatures = mockGeoJson.features.map(feature => {
    let territoryId = feature.properties.name;

    // Try to extract from sourceFile if name doesn't match
    if (feature.properties.sourceFile) {
        const match = feature.properties.sourceFile.match(/TERRITORIO\s+(\d+)\.kml/i);
        if (match) {
            territoryId = match[1];
        }
    }

    const data = mockSheetData.find(row => row.id === territoryId);
    return {
        ...feature,
        properties: {
            ...feature.properties,
            ...data
        }
    };
});

fixedFeatures.forEach(f => {
    console.log(`Feature: ${f.properties.sourceFile}, ID found: ${f.properties.id}, Status: ${f.properties.status}`);
});

import { fetchTerritoryData } from './src/lib/sheets.js';

// Mock data
const csvData = `Núm. de terr.,Zona,Estado,Última fecha en que se completó*,Asignado a,Fecha en que se asignó,Fecha en que se completó,Asignado a,Fecha en que se asignó,Fecha en que se completó
1,Sants,Libre,,Maria del M Solé,3/09/2025,,,,
2,Les Corts,Asignado,31-08-2025,Flor,21/07/2025,,,,
5,Sants,Asignado,11-11-2025,Fran,5/09/2025,11/11/2025,Raquel,18/11/2025,`;

// Mock fetch
global.fetch = async (url) => {
    return {
        text: async () => csvData
    };
};

console.log("Verifying fetchTerritoryData...");
const data = await fetchTerritoryData('http://dummy-url');
const territory5 = data.find(t => t.id === '5');

console.log("Territory 5:", territory5);

if (territory5.publisher === 'Raquel' && territory5.assignedDate === '18/11/2025') {
    console.log("SUCCESS: Latest assignment found.");
} else {
    console.error("FAILURE: Incorrect assignment data.");
    process.exit(1);
}

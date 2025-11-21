import Papa from 'papaparse';

const csvData = `Núm. de terr.,Zona,Estado,Última fecha en que se completó*,Asignado a,Fecha en que se asignó,Fecha en que se completó,Asignado a,Fecha en que se asignó,Fecha en que se completó
1,Sants,Libre,,Maria del M Solé,3/09/2025,,,,
2,Les Corts,Asignado,31-08-2025,Flor,21/07/2025,,,,
5,Sants,Asignado,11-11-2025,Fran,5/09/2025,11/11/2025,Raquel,18/11/2025,`;

console.log("\n--- Testing new parsing logic ---");
Papa.parse(csvData, {
    header: false,
    complete: (results) => {
        const rows = results.data;
        // Skip header
        const dataRows = rows.slice(1);

        const mappedData = dataRows.map(row => {
            // Basic info
            const id = row[0];
            const zone = row[1];
            const status = row[2] === 'Libre' ? 'free' : 'assigned';
            const lastCompletedDate = row[3];

            // Find latest assignment
            // Groups start at index 4. Each group is 3 columns: Assigned To, Date Assigned, Date Completed
            let publisher = '';
            let assignedDate = '';

            for (let i = 4; i < row.length; i += 3) {
                const p = row[i];
                const d = row[i + 1];
                // If there is a publisher, update our latest info
                if (p && p.trim() !== '') {
                    publisher = p;
                    assignedDate = d;
                }
            }

            return {
                id,
                zone,
                status,
                publisher,
                assignedDate,
                lastCompletedDate
            };
        });

        console.log("Row 5 (Territory 5):", mappedData.find(d => d.id === '5'));
    }
});

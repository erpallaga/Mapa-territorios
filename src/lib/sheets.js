import Papa from 'papaparse';

/**
 * Fetches territory data from a Google Sheet published as CSV.
 * @param {string} sheetUrl - The URL of the published CSV.
 * @returns {Promise<Array>} - Array of territory objects.
 */
export async function fetchTerritoryData(sheetUrl) {
    if (!sheetUrl) return [];

    try {
        const response = await fetch(sheetUrl);
        const csvText = await response.text();

        return new Promise((resolve, reject) => {
            Papa.parse(csvText, {
                header: false, // Changed to false to handle duplicate headers
                skipEmptyLines: true,
                complete: (results) => {
                    const rows = results.data;
                    // Skip header row
                    const dataRows = rows.slice(1);

                    const mappedData = dataRows.map(row => {
                        // Basic info
                        // Column indices based on fixed structure:
                        // 0: Núm. de terr.
                        // 1: Zona
                        // 2: Estado
                        // 3: Última fecha en que se completó*
                        const id = row[0];
                        const zone = row[1];
                        const statusValue = (row[2] || '').trim().toUpperCase();
                        const status = statusValue === 'LIBRE' ? 'free' : 'assigned';
                        const lastCompletedDate = row[3];

                        // Find latest assignment and calculate 12-month history
                        // Groups start at index 4. Each group is 3 columns: 
                        // [Assignee, Date Assigned, Date Completed]
                        let publisher = '';
                        let assignedDate = '';
                        let completionCount12m = 0;
                        const history = [];

                        const oneYearAgo = new Date();
                        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

                        // Iterate through groups of 3 columns
                        for (let i = 4; i < row.length; i += 3) {
                            const p = row[i];
                            const d = row[i + 1];
                            const c = row[i + 2]; // Completion Date

                            // If there is a publisher name, update our latest info
                            if (p && p.trim() !== '') {
                                publisher = p;
                                assignedDate = d;

                                history.push({
                                    publisher: p.trim(),
                                    assignedDate: (d || '').trim(),
                                    completedDate: (c || '').trim()
                                });
                            }

                            // Check completion date for 12-month count
                            if (c && c.trim() !== '') {
                                const [day, month, year] = c.split(/[\/\-]/).map(Number);
                                if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                                    const fullYear = year < 100 ? year + 2000 : year;
                                    const completionDate = new Date(fullYear, month - 1, day);
                                    if (completionDate >= oneYearAgo) {
                                        completionCount12m++;
                                    }
                                }
                            }
                        }

                        // Reverse history so latest assignments show up at the top
                        history.reverse();

                        // Calculate expired status (>= 4 months assigned)
                        let isExpired = false;
                        let expiredDays = 0;
                        if (status === 'assigned' && assignedDate && assignedDate.trim() !== '') {
                            const [aDay, aMonth, aYear] = assignedDate.split(/[\/\-]/).map(Number);
                            if (aDay && aMonth && aYear) {
                                const fullYear = aYear < 100 ? aYear + 2000 : aYear;
                                const assignedDateObj = new Date(fullYear, aMonth - 1, aDay);
                                const now = new Date();
                                const diffMs = now - assignedDateObj;
                                const diffDaysTotal = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                                const fourMonthsInDays = Math.round(4 * 30.44); // ~122 days
                                if (diffDaysTotal >= fourMonthsInDays) {
                                    isExpired = true;
                                    expiredDays = diffDaysTotal - fourMonthsInDays; // Days PAST the 4-month mark
                                }
                            }
                        }

                        return {
                            id,
                            zone,
                            status,
                            publisher,
                            assignedDate,
                            lastCompletedDate,
                            completionCount12m,
                            history,
                            isExpired,
                            expiredDays
                        };
                    });
                    resolve(mappedData);
                },
                error: (error) => {
                    reject(error);
                }
            });
        });
    } catch (error) {
        console.error("Error fetching sheet data:", error);
        return [];
    }
}

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path'); // Use path for relative paths
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const csvParser = require('csv-parser');

(async () => {
    const seriesIndexCsvPath = path.join(__dirname, 'files', 'seriesIndex.csv');
    const seriesCsvPath = path.join(__dirname, 'files', 'series.csv');

    try {
        const rows = [];
        if (fs.existsSync(seriesIndexCsvPath)) {
            fs.createReadStream(seriesIndexCsvPath)
                .pipe(csvParser())
                .on('data', (row) => rows.push(row))
                .on('end', async () => {
                    if (rows.length > 0) {
                        console.log(`Found ${rows.length} series in ${seriesIndexCsvPath}.`);
                        for (const row of rows) {
                            const seriesName = row.seriesName;
                            const seriesUrl = row.seriesURL;
                            const seriesTag = row.seriesTag;

                            if (!seriesUrl) {
                                console.warn('Skipping row with missing seriesURL:', row);
                                continue;
                            }

                            console.log(`Processing series: ${seriesName}`);
                            await executeScript(seriesUrl, seriesTag); // Process each series
                        }
                    } else {
                        console.error('No data found in seriesIndex.csv.');
                    }
                });
        } else {
            console.error(`${seriesIndexCsvPath} does not exist.`);
        }
    } catch (error) {
        console.error('Error reading seriesIndex.csv:', error.message);
    }

    async function executeScript(seriesUrl, seriesTag) {
        const seriesCsvWriter = createCsvWriter({
            path: seriesCsvPath,
            header: [
                { id: 'Title', title: 'Title' },
                { id: 'SeriesTag', title: 'SeriesTag' },
                { id: 'DateRecorded', title: 'DateRecorded' }
            ],
            append: true // Append new rows to the file
        });

        let browser;
        try {
            browser = await puppeteer.launch();
            const page = await browser.newPage();

            console.log(`Navigating to ${seriesUrl}...`);
            await page.goto(seriesUrl, { waitUntil: 'networkidle2' });

            console.log('Extracting titles...');
            const seriesTitles = await page.evaluate(() => {
                const titleElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, em');
                const titles = Array.from(titleElements).map(el => el.textContent.trim());

                // Find the index of "Films in this Program"
                const startIndex = titles.findIndex(title => title.toUpperCase() === 'FILMS IN THIS PROGRAM');
                if (startIndex === -1) {
                    console.warn('Start index for "Films in this Program" not found. Returning no titles.');
                    return []; // Return an empty array if the phrase is not found
                }
                return titles.slice(startIndex + 1); // Start collecting titles after the phrase
            });

            // Filter out empty or whitespace-only titles and skip "?????? CINEMA"
            const filteredTitles = seriesTitles.filter(title => title.trim() !== '' && title !== '?????? CINEMA');
            if (filteredTitles.length === 0) {
                console.warn('No valid titles extracted. Skipping this series.');
                return; // Exit early if no valid titles are found
            }

            console.log(`Extracted ${filteredTitles.length} valid titles.`);

            // Initialize existingRows as an empty array if series.csv does not exist
            let existingRows = [];
            if (fs.existsSync(seriesCsvPath)) {
                existingRows = await new Promise((resolve, reject) => {
                    const rows = [];
                    fs.createReadStream(seriesCsvPath)
                        .pipe(csvParser())
                        .on('data', (row) => rows.push(row))
                        .on('end', () => resolve(rows))
                        .on('error', reject);
                });

                // Filter out empty rows
                existingRows = existingRows.filter(row => row.Title && row.SeriesTag);
            }

            // Remove rows with the matching seriesTag only if titles were successfully retrieved
            const filteredRows = existingRows.filter(row => row.SeriesTag !== seriesTag);
            const tempCsvWriter = createCsvWriter({
                path: seriesCsvPath,
                header: [
                    { id: 'Title', title: 'Title' },
                    { id: 'SeriesTag', title: 'SeriesTag' },
                    { id: 'DateRecorded', title: 'DateRecorded' }
                ]
            });

            await tempCsvWriter.writeRecords(filteredRows);
            console.log(`Removed rows with SeriesTag "${seriesTag}" from ${seriesCsvPath}.`);

            const currentTimestamp = new Date().toISOString();
            const seriesRecords = filteredTitles.map(title => ({
                Title: title,
                SeriesTag: seriesTag,
                DateRecorded: currentTimestamp
            })); // Include seriesTag and timestamp

            if (seriesRecords.length === 0) {
                console.log('No new records to write for this series.');
                return;
            }

            await seriesCsvWriter.writeRecords(seriesRecords);
            console.log('series.csv updated successfully.');
        } catch (error) {
            console.error('An error occurred:', error.message);
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }
})();
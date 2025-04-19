const puppeteer = require('puppeteer');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const csvParser = require('csv-parser');

(async () => {
    const seriesIndexCsvPath = 'seriesIndex.csv'; // Correct file path

    // Read the first non-header row from seriesIndex.csv
    let seriesUrl, seriesTag;
    try {
        const rows = [];
        if (fs.existsSync(seriesIndexCsvPath)) {
            fs.createReadStream(seriesIndexCsvPath)
                .pipe(csvParser())
                .on('data', (row) => rows.push(row))
                .on('end', () => {
                    if (rows.length > 0) {
                        const firstRow = rows[0];
                        console.log('First row fields:', firstRow); // Log the fields
                        seriesUrl = firstRow.seriesURL; // Use the correct field name
                        seriesTag = firstRow.seriesTag; // Extract seriesTag
                        if (!seriesUrl) {
                            throw new Error('seriesURL field is missing or empty in the first row.');
                        }
                        executeScript(seriesUrl, seriesTag); // Pass seriesTag to the script
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
        const seriesCsvPath = 'series.csv';

        // Delete series.csv if it exists
        if (fs.existsSync(seriesCsvPath)) {
            fs.unlinkSync(seriesCsvPath);
            console.log(`${seriesCsvPath} deleted.`);
        }

        const seriesCsvWriter = createCsvWriter({
            path: seriesCsvPath,
            header: [
                { id: 'title', title: 'Title' },
                { id: 'seriesTag', title: 'SeriesTag' }
            ]
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
                console.log('Extracted titles:', titles); // Debugging log

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
                console.warn('No valid titles extracted. Please check the page structure or selector.');
            } else {
                console.log(`Extracted ${filteredTitles.length} valid titles.`);
            }

            const seriesRecords = filteredTitles.map(title => ({ title, seriesTag })); // Include seriesTag
            await seriesCsvWriter.writeRecords(seriesRecords);
            console.log('series.csv written successfully.');
        } catch (error) {
            console.error('An error occurred:', error.message);
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }
})();
/**
 * beaconSeries.js
 * Processes series information from files/seriesIndex.csv,
 * scrapes film titles from each series URL, and updates files/series.csv.
 * Usage: node beaconSeries.js
 * - Reads all rows from files/seriesIndex.csv.
 * - For each series, scrapes titles from the provided URL.
 * - Updates files/series.csv with latest titles and SeriesTag.
 * - Removes outdated rows for the same SeriesTag before appending new rows.
 * - Ensures duplicate titles are not added.
 * Dependencies: puppeteer, csv-parser, csv-writer, ./utils.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const csvParser = require('csv-parser');
const { ensureHeader, deduplicateRows } = require('./utils');

process.on('unhandledRejection', (reason) => {
    console.error('[ERROR] Unhandled promise rejection in beaconSeries.js:', reason);
    console.log('[SUMMARY] Processed: 0, Skipped: 0');
    process.exit(1);
});

(async () => {
    console.log('[START] beaconSeries.js');
    const seriesIndexCsvPath = path.join(__dirname, 'files', 'seriesIndex.csv');
    const seriesCsvPath = path.join(__dirname, 'files', 'series.csv');

    let processedCount = 0;
    let skippedCount = 0;
    let anyRecordsAdded = false;
    let allSkippedForMissingFields = true;
    let allTitles = {};

    try {
        ensureHeader(seriesCsvPath, 'Title,SeriesTag,DateRecorded');
        ensureHeader(seriesIndexCsvPath, 'seriesName,seriesURL,seriesTag');

        const rows = [];
        if (!fs.existsSync(seriesIndexCsvPath)) {
            console.error(`[ERROR] ${seriesIndexCsvPath} does not exist.`);
            console.log(`[SUMMARY] Processed: ${processedCount}, Skipped: ${skippedCount}`);
            return;
        }
        fs.createReadStream(seriesIndexCsvPath)
            .pipe(csvParser())
            .on('data', (row) => {
                if (!row || typeof row !== 'object') {
                    console.warn('[WARN] Skipping malformed row in seriesIndex.csv:', row);
                    return;
                }
                rows.push(row);
            })
            .on('end', async () => {
                if (rows.length > 0) {
                    console.log(`[INFO] Found ${rows.length} series in ${seriesIndexCsvPath}.`);

                    const seenTags = new Set();
                    for (const row of rows) {
                        if (row.seriesTag) {
                            if (seenTags.has(row.seriesTag)) {
                                console.warn(`[WARN] Duplicate SeriesTag "${row.seriesTag}" found in seriesIndex.csv.`);
                            }
                            seenTags.add(row.seriesTag);
                        }
                    }

                    for (const row of rows) {
                        const seriesName = row.seriesName;
                        const seriesUrl = row.seriesURL;
                        const seriesTag = row.seriesTag;

                        if (!seriesName || !seriesUrl || !seriesTag) {
                            console.warn(`[WARN] Skipping row with missing required field(s):`, row);
                            skippedCount++;
                            continue;
                        }

                        allSkippedForMissingFields = false;

                        console.log(`[INFO] Processing series: ${seriesName}`);
                        const success = await executeScript(seriesUrl, seriesTag, seriesCsvPath, allTitles);
                        if (success) {
                            processedCount++;
                            anyRecordsAdded = true;
                        } else {
                            skippedCount++;
                        }
                    }

                    const multiTagTitles = Object.entries(allTitles).filter(([title, tags]) => tags.size > 1);
                    if (multiTagTitles.length > 0) {
                        console.warn('[WARN] The following titles appear in multiple SeriesTags:', multiTagTitles.map(([t, tags]) => `${t} [${[...tags].join(', ')}]`).join('; '));
                    }

                    console.log(`[SUMMARY] Processed: ${processedCount}, Skipped: ${skippedCount}`);
                } else {
                    console.info('[INFO] No series found in seriesIndex.csv.');
                    console.log(`[SUMMARY] Processed: ${processedCount}, Skipped: ${skippedCount}`);
                }
                if (!anyRecordsAdded) {
                    console.log('[SUMMARY] No new records were added to series.csv.');
                }
                if (allSkippedForMissingFields) {
                    console.warn('[SUMMARY] All rows in seriesIndex.csv were skipped due to missing required fields.');
                }
                if (processedCount === 0) {
                    console.warn('[WARN] No valid series records were added for any series. Please check your seriesIndex.csv and the source URLs.');
                }
                console.log(`[SUMMARY] beaconSeries.js finished. Processed: ${processedCount}, Skipped: ${skippedCount}`);
            });
    } catch (error) {
        if (error && error.message) {
            console.error('[ERROR] Error reading seriesIndex.csv:', error.message);
            if (error.stack && !error.message.includes('ENOENT')) {
                console.error(error.stack);
            }
            if (error.message.includes('no such file or directory') && error.message.includes('seriesIndex.csv')) {
                console.error('[ERROR] files/seriesIndex.csv is missing. Please create or update this file.');
            }
        } else {
            console.error('[ERROR] An unknown error occurred:', error);
        }
        console.log(`[SUMMARY] Processed: ${processedCount}, Skipped: ${skippedCount}`);
    }
    console.log(`[SUMMARY] beaconSeries.js finished. Processed: ${processedCount}, Skipped: ${skippedCount}`);
})().catch(err => {
    console.error('[ERROR] Unhandled exception in beaconSeries.js:', err);
    console.log('[SUMMARY] Processed: 0, Skipped: 0');
});

// Scrape titles for a single series and update series.csv
async function executeScript(seriesUrl, seriesTag, seriesCsvPath, allTitles) {
    ensureHeader(seriesCsvPath, 'Title,SeriesTag,DateRecorded');

    const seriesCsvWriter = createCsvWriter({
        path: seriesCsvPath,
        header: [
            { id: 'Title', title: 'Title' },
            { id: 'SeriesTag', title: 'SeriesTag' },
            { id: 'DateRecorded', title: 'DateRecorded' }
        ],
        append: true
    });

    let browser;
    try {
        browser = await puppeteer.launch();
        const page = await browser.newPage();

        console.log(`[INFO] Navigating to ${seriesUrl}...`);
        await page.goto(seriesUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // Extract titles from the page
        const seriesTitles = await page.evaluate(() => {
            const titleElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, em');
            const titles = Array.from(titleElements).map(el => el.textContent.trim());
            const startIndex = titles.findIndex(title => title.toUpperCase() === 'FILMS IN THIS PROGRAM');
            if (startIndex === -1) {
                console.warn('[WARN] Start index for "Films in this Program" not found. Returning no titles.');
                return [];
            }
            return titles.slice(startIndex + 1);
        });

        if (!Array.isArray(seriesTitles) || seriesTitles.length === 0) {
            console.warn('[WARN] No titles found on the page. Skipping this series.');
            return false;
        }

        let filteredTitles = seriesTitles.filter(title => title.trim() !== '' && title !== '?????? CINEMA');

        const titleCounts = {};
        for (const t of seriesTitles) {
            titleCounts[t] = (titleCounts[t] || 0) + 1;
        }
        const duplicateTitles = Object.entries(titleCounts).filter(([t, count]) => count > 1);
        if (duplicateTitles.length > 0) {
            console.warn(`[WARN] Duplicate titles found in scraped titles for SeriesTag "${seriesTag}": ${duplicateTitles.map(([t]) => t).join(', ')}`);
        }
        filteredTitles = [...new Set(filteredTitles)];

        if (filteredTitles.length === 0) {
            console.warn('[WARN] No valid titles extracted. Skipping this series.');
            return false;
        }

        console.log(`[INFO] Extracted ${filteredTitles.length} valid titles.`);

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
            existingRows = existingRows.filter(row => row.Title && row.SeriesTag);
        }

        // Remove old rows for this SeriesTag
        // This ensures that outdated rows for the same SeriesTag are not retained in the CSV.
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
        if (existingRows.length !== filteredRows.length) {
            console.log(`[INFO] Removed rows with SeriesTag "${seriesTag}" from ${seriesCsvPath}.`);
        } else {
            console.log(`[INFO] No existing rows with SeriesTag "${seriesTag}" found in ${seriesCsvPath}.`);
        }

        // Deduplicate titles before writing
        // This ensures that duplicate titles are not added to the CSV.
        const existingTitleSet = new Set(existingRows.map(r => `${r.Title}|${r.SeriesTag}`));
        const currentTimestamp = new Date().toISOString();
        let seriesRecords = filteredTitles
            .filter(title => !existingTitleSet.has(`${title}|${seriesTag}`))
            .map(title => ({
                Title: title,
                SeriesTag: seriesTag,
                DateRecorded: currentTimestamp
            }));
        // Use deduplicateRows to ensure no duplicate Title within this batch
        seriesRecords = deduplicateRows(seriesRecords, rec => rec.Title);

        const writtenTitleSet = new Set();
        let duplicateWritten = false;
        for (const rec of seriesRecords) {
            if (writtenTitleSet.has(rec.Title)) duplicateWritten = true;
            writtenTitleSet.add(rec.Title);
        }
        if (duplicateWritten) {
            console.warn(`[WARN] Duplicate titles found in final written records for SeriesTag "${seriesTag}".`);
        }

        for (const t of filteredTitles) {
            if (!allTitles[t]) allTitles[t] = new Set();
            allTitles[t].add(seriesTag);
        }

        if (seriesRecords.length === 0) {
            console.log('[INFO] No new records to write for this series.');
            console.warn('[WARN] No valid series records written for SeriesTag:', seriesTag);
            return false;
        }

        await seriesCsvWriter.writeRecords(seriesRecords);
        console.log(`[INFO] series.csv updated successfully. ${seriesRecords.length} records added for SeriesTag "${seriesTag}".`);
        // Ensure header after writing
        // This ensures that the CSV file has the correct header after records are written.
        ensureHeader(seriesCsvPath, 'Title,SeriesTag,DateRecorded');
        return true;
    } catch (error) {
        if (error && error.message) {
            console.error('[ERROR] An error occurred:', error.message);
            if (error.stack && !error.message.includes('ENOENT')) {
                console.error(error.stack);
            }
            if (
                error.message.includes('net::ERR_NAME_NOT_RESOLVED') ||
                error.message.includes('Invalid URL') ||
                error.message.includes('net::ERR_CONNECTION_REFUSED')
            ) {
                console.error(`[ERROR] Unable to navigate to series URL "${seriesUrl}". Please check the URL in seriesIndex.csv.`);
            }
            if (error.message.includes('Navigation timeout')) {
                console.error(`[ERROR] Navigation to "${seriesUrl}" timed out. The site may be down or slow.`);
            }
            if (
                error.message.includes('404') ||
                error.message.includes('500')
            ) {
                console.error(`[ERROR] Received HTTP error (${error.message}) for "${seriesUrl}". The page may not exist or is temporarily unavailable.`);
            }
        } else {
            console.error('[ERROR] An unknown error occurred:', error);
        }
    } finally {
        if (browser) await browser.close();
    }
}
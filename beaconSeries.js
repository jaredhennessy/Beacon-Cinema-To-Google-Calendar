/**
 * beaconSeries.js
 * Scrapes series film titles from The Beacon Cinema website.
 * 
 * Usage: node beaconSeries.js
 * 
 * Operation:
 * - Reads series definitions from files/seriesIndex.csv
 * - For each series URL, scrapes all film titles
 * - Updates files/series.csv with latest titles and SeriesTag
 * - Removes outdated rows for each SeriesTag before adding new ones
 * - Deduplicates titles within and across series
 * 
 * Required files:
 * - files/seriesIndex.csv (must exist with header and data)
 * - files/series.csv (created if missing)
 * 
 * Dependencies:
 * - puppeteer (web scraping)
 * - csv-parser (reading CSV files)
 * - csv-writer (writing CSV files)
 * - ./utils.js (CSV utilities)
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const csvParser = require('csv-parser');
const { ensureHeader, deduplicateRows } = require('./utils');
const logger = require('./logger')('beaconSeries');

process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection:', reason);
    logger.summary(0, 0, 1);
    process.exit(1);
});

(async () => {
    logger.info('Starting beaconSeries.js');
    const seriesIndexCsvPath = path.join(__dirname, 'files', 'seriesIndex.csv');
    const seriesCsvPath = path.join(__dirname, 'files', 'series.csv');

    let processedCount = 0;
    let skippedCount = 0;
    let allTitles = {};

    try {
        ensureHeader(seriesCsvPath, 'Title,SeriesTag,DateRecorded');
        ensureHeader(seriesIndexCsvPath, 'seriesName,seriesURL,seriesTag');

        if (!fs.existsSync(seriesIndexCsvPath)) {
            logger.error(`${seriesIndexCsvPath} does not exist.`);
            logger.summary(0, 0, 1);
            process.exit(1);
        }

        // Read all rows from seriesIndex.csv
        const rows = await new Promise((resolve, reject) => {
            const out = [];
            fs.createReadStream(seriesIndexCsvPath)
                .pipe(csvParser())
                .on('data', (row) => {
                    if (!row || typeof row !== 'object') {
                        logger.warn('Skipping malformed row in seriesIndex.csv:', row);
                        return;
                    }
                    out.push(row);
                })
                .on('end', () => resolve(out))
                .on('error', reject);
        });

        // Read all existing series.csv rows
        let existingRows = [];
        if (fs.existsSync(seriesCsvPath)) {
            existingRows = await new Promise((resolve, reject) => {
                const out = [];
                fs.createReadStream(seriesCsvPath)
                    .pipe(csvParser())
                    .on('data', (row) => {
                        if (row.Title && row.SeriesTag) out.push(row);
                    })
                    .on('end', () => resolve(out))
                    .on('error', reject);
            });
        }

        // Process all series rows
        const { processedCount: pc, skippedCount: sc } = await processSeriesRows(rows, existingRows, seriesCsvPath, allTitles, seriesIndexCsvPath);
        processedCount = pc;
        skippedCount = sc;

        logger.summary(`Processed: ${processedCount}, Skipped: ${skippedCount}`);
        process.exit(0);
    } catch (error) {
        if (error && error.message) {
            logger.error('Error reading seriesIndex.csv:', error.message);
            if (error.stack && !error.message.includes('ENOENT')) {
                logger.error(error.stack);
            }
            if (error.message.includes('no such file or directory') && error.message.includes('seriesIndex.csv')) {
                logger.error('files/seriesIndex.csv is missing. Please create or update this file.');
            }
        } else {
            logger.error('An unknown error occurred:', error);
        }
        logger.summary(`Processed: ${processedCount}, Skipped: ${skippedCount}`);
        process.exit(1);
    }
})();

// Scrape titles for a single series and return new records (do not write to file)
async function executeScript(seriesUrl, seriesTag, seriesCsvPath, allTitles) {
    ensureHeader(seriesCsvPath, 'Title,SeriesTag,DateRecorded');

    let browser;
    try {
        browser = await puppeteer.launch();
        const page = await browser.newPage();

        logger.info(`Navigating to ${seriesUrl}...`);
        await page.goto(seriesUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        // Extract titles from the page
        const seriesTitles = await page.evaluate(() => {
            const titleElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, em');
            const titles = Array.from(titleElements).map(el => el.textContent.trim());
            console.log('Found titles:', titles); // This logs in browser context
            const startIndex = titles.findIndex(title => title.toUpperCase() === 'FILMS IN THIS PROGRAM');
            if (startIndex === -1) {
                logger.warn('Start index for "Films in this Program" not found. Returning no titles.');
                return [];
            }
            return titles.slice(startIndex + 1);
        });

        if (!Array.isArray(seriesTitles) || seriesTitles.length === 0) {
            logger.warn('No titles found on the page. Skipping this series.');
            return [];
        }

        let filteredTitles = seriesTitles.filter(title => title.trim() !== '' && title !== '?????? CINEMA');

        const titleCounts = {};
        for (const t of seriesTitles) {
            titleCounts[t] = (titleCounts[t] || 0) + 1;
        }
        const duplicateTitles = Object.entries(titleCounts).filter(([t, count]) => count > 1);
        if (duplicateTitles.length > 0) {
            logger.warn(`Duplicate titles found in scraped titles for SeriesTag "${seriesTag}": ${duplicateTitles.map(([t]) => t).join(', ')}`);
        }
        filteredTitles = [...new Set(filteredTitles)];

        if (filteredTitles.length === 0) {
            logger.warn('No valid titles extracted. Skipping this series.');
            return [];
        }

        logger.info(`Extracted ${filteredTitles.length} valid titles.`);

        const currentTimestamp = new Date().toISOString();
        let seriesRecords = filteredTitles.map(title => ({
            Title: title,
            SeriesTag: seriesTag,
            DateRecorded: currentTimestamp
        }));

        // Use deduplicateRows to ensure no duplicate Title within this batch
        seriesRecords = deduplicateRows(seriesRecords, rec => rec.Title);

        for (const t of filteredTitles) {
            if (!allTitles[t]) allTitles[t] = new Set();
            allTitles[t].add(seriesTag);
        }

        if (seriesRecords.length === 0) {
            logger.info('No new records to write for this series.');
            logger.warn('No valid series records written for SeriesTag:', seriesTag);
            return [];
        }

        // Return new records for this series
        return seriesRecords;
    } catch (error) {
        if (error && error.message) {
            logger.error('An error occurred:', error.message);
            if (error.stack && !error.message.includes('ENOENT')) {
                logger.error(error.stack);
            }
            if (
                error.message.includes('net::ERR_NAME_NOT_RESOLVED') ||
                error.message.includes('Invalid URL') ||
                error.message.includes('net::ERR_CONNECTION_REFUSED')
            ) {
                logger.error(`Unable to navigate to series URL "${seriesUrl}". Please check the URL in seriesIndex.csv.`);
            }
            if (error.message.includes('Navigation timeout')) {
                logger.error(`Navigation to "${seriesUrl}" timed out. The site may be down or slow.`);
            }
            if (
                error.message.includes('404') ||
                error.message.includes('500')
            ) {
                logger.error(`Received HTTP error (${error.message}) for "${seriesUrl}". The page may not exist or is temporarily unavailable.`);
            }
        } else {
            logger.error('An unknown error occurred:', error);
        }
        return [];
    } finally {
        if (browser) await browser.close();
    }
}

// Process all series rows and write to series.csv
async function processSeriesRows(rows, existingRows, seriesCsvPath, allTitles, seriesIndexCsvPath) {
    let processedCount = 0;
    let skippedCount = 0;
    let allSkippedForMissingFields = true;
    if (rows.length > 0) {
        logger.info(`Found ${rows.length} series in ${seriesIndexCsvPath}.`);
        const seenTags = new Set();
        let allNewRecords = [];
        for (const row of rows) {
            if (!row.seriesURL || !row.seriesTag) {
                logger.warn('Skipping row with missing seriesURL or seriesTag:', row);
                skippedCount++;
                continue;
            }
            if (seenTags.has(row.seriesTag)) {
                logger.warn(`Duplicate seriesTag "${row.seriesTag}" found in seriesIndex.csv.`);
            }
            seenTags.add(row.seriesTag);
            const newRecords = await executeScript(row.seriesURL, row.seriesTag, seriesCsvPath, allTitles);
            if (newRecords && newRecords.length > 0) {
                allNewRecords.push(...newRecords);
                processedCount += newRecords.length;
                allSkippedForMissingFields = false;
            } else {
                skippedCount++;
            }
        }
        // Remove old rows for the same SeriesTag(s)
        const tagsToReplace = new Set(rows.map(r => r.seriesTag));
        const filteredExisting = existingRows.filter(r => !tagsToReplace.has(r.SeriesTag));
        // Deduplicate all new records by Title+SeriesTag
        allNewRecords = deduplicateRows(allNewRecords, rec => `${rec.Title}|${rec.SeriesTag}`);
        // Write combined records to series.csv
        const csvWriter = createCsvWriter({
            path: seriesCsvPath,
            header: [
                { id: 'Title', title: 'Title' },
                { id: 'SeriesTag', title: 'SeriesTag' },
                { id: 'DateRecorded', title: 'DateRecorded' }
            ]
        });
        await csvWriter.writeRecords([...filteredExisting, ...allNewRecords]);
        ensureHeader(seriesCsvPath, 'Title,SeriesTag,DateRecorded');
        if (allSkippedForMissingFields) {
            logger.warn('All series were skipped due to missing required fields.');
        }
    } else {
        logger.warn('No rows found in seriesIndex.csv.');
    }
    return { processedCount, skippedCount };
}
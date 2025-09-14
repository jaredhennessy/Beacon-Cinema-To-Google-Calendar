
/**
 * beaconSeries.js
 * Scrapes series film titles from The Beacon Cinema website and updates Google Sheet 'series'.
 */

require('dotenv').config();

// @ts-check
// External dependencies
const puppeteer = require('puppeteer');
const { getSheetRows, setSheetRows } = require('./sheetsUtils');

// Internal dependencies
const { deduplicateRows, navigateWithRetry } = require('./utils');
const logger = require('./logger')('beaconSeries');
const { setupErrorHandling, handleError } = require('./errorHandler');

/** @typedef {import('./types').SeriesRow} SeriesRow */
/** @typedef {import('./types').SeriesIndexRow} SeriesIndexRow */

setupErrorHandling(logger, 'beaconSeries.js');

/**
 * Scrapes film titles from a series page
 * @param {string} seriesUrl - URL of the series page to scrape
 * @param {string} seriesTag - Tag identifying the series
 * @deprecated seriesCsvPath - Path to the series CSV file (no longer used)
 * @param {Set<string>} allTitles - Set of all known titles to avoid duplicates
 * @returns {Promise<SeriesRow[]>} Array of series records
 */
async function executeScript(seriesUrl, seriesTag, allTitles) {
    // Parameter validation
    if (!seriesUrl || typeof seriesUrl !== 'string') {
        throw new Error('executeScript: seriesUrl must be a non-empty string');
    }
    if (!seriesTag || typeof seriesTag !== 'string') {
        throw new Error('executeScript: seriesTag must be a non-empty string');
    }
    // seriesCsvPath is obsolete and ignored
    if (!allTitles || !(allTitles instanceof Set)) {
        throw new Error('executeScript: allTitles must be a Set');
    }
    
    try {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        
        const navigationSuccess = await navigateWithRetry(page, seriesUrl, { logger });
        if (!navigationSuccess) {
            logger.error(`Failed to load ${seriesUrl} after retries`);
            await browser.close();
            return [];
        }

        // Extract titles from the page
        const titles = await page.evaluate(() => {
            const elements = document.querySelectorAll('h1, h2, h3');
            return Array.from(elements).map(el => el.textContent?.trim()).filter(Boolean);
        });

        await browser.close();

        const validTitles = titles.filter(title => title && !allTitles.has(title));
        logger.info(`Extracted ${validTitles.length} valid titles.`);

        return validTitles.map(title => ({
            Title: title,
            SeriesTag: seriesTag,
            DateRecorded: new Date().toISOString()
        }));
    } catch (error) {
        handleError(logger, error instanceof Error ? error : new Error(String(error)), `Error scraping series at ${seriesUrl}`);
        return [];
    }
}

/**
 * Process series rows and write to Google Sheet
 * @param {Array<{seriesName: string, seriesURL: string, seriesTag: string}>} rows
 * @param {Array<{Title: string, SeriesTag: string, DateRecorded: string}>} existingRows
 * @param {Set<string>} allTitles
 * @returns {Promise<{ processedCount: number; skippedCount: number }>}
 */
/**
 * Process series rows and write to Google Sheet
 * @param {Array<{seriesName: string, seriesURL: string, seriesTag: string}>} rows
 * @param {Array<{Title: string, SeriesTag: string, DateRecorded: string}>} existingRows
 * @param {Set<string>} allTitles
 * @returns {Promise<{ processedCount: number; skippedCount: number }>}
 */
async function processSeriesRows(rows, existingRows, allTitles) {
    // Parameter validation
    if (!rows || !Array.isArray(rows)) {
        throw new Error('processSeriesRows: rows must be an array');
    }
    if (!existingRows || !Array.isArray(existingRows)) {
        throw new Error('processSeriesRows: existingRows must be an array');
    }
    if (!allTitles || !(allTitles instanceof Set)) {
        throw new Error('processSeriesRows: allTitles must be a Set');
    }
    
    let processedCount = 0;
    let skippedCount = 0;
    const totalRows = rows.length;

    try {
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            logger.info(`Processing ${i + 1}/${totalRows}: ${row.seriesName}`);
            
            const newRecords = await executeScript(row.seriesURL, row.seriesTag, allTitles);
            processedCount += newRecords.length;
            skippedCount += newRecords.filter(r => allTitles.has(r.Title)).length;
            
            // Add new titles to set to prevent duplicates
            newRecords.forEach(record => allTitles.add(record.Title));
            
            // Update Google Sheet
            if (newRecords.length > 0) {
                let sheetRows = await getSheetRows('series');
                if (!sheetRows.length || sheetRows[0][0] !== 'Title') {
                    sheetRows = [['Title', 'SeriesTag', 'DateRecorded']];
                }
                for (const rec of newRecords) {
                    sheetRows.push([rec.Title, rec.SeriesTag, rec.DateRecorded]);
                }
                await setSheetRows('series', sheetRows);
            }
            
            logger.info(`Progress: ${i + 1}/${totalRows} complete. Found ${newRecords.length} titles.`);
        }

        return { processedCount, skippedCount };
    } catch (error) {
        handleError(logger, error instanceof Error ? error : new Error(String(error)), 'Error processing series rows', true);
        return { processedCount: 0, skippedCount: 0 };
    }
}

// Main execution
(async () => {
    logger.info('Starting beaconSeries.js');
    let processedCount = 0;
    let skippedCount = 0;
    
    // Set global timeout for the entire script (20 minutes)
    const globalTimeout = setTimeout(() => {
        logger.error('Script timeout reached (20 minutes). Exiting to prevent hanging.');
        process.exit(1);
    }, 20 * 60 * 1000);
    
    try {
        // Read seriesIndex from Google Sheet
        const rowsRaw = await getSheetRows('seriesIndex');
        // Convert rows to objects
        const header = rowsRaw[0];
        const rows = rowsRaw.slice(1).map(r => ({
            seriesName: r[header.indexOf('seriesName')],
            seriesURL: r[header.indexOf('seriesURL')],
            seriesTag: r[header.indexOf('seriesTag')],
        })).filter(r => r.seriesURL && r.seriesTag);

        logger.info(`Found ${rows.length} series in Google Sheet 'seriesIndex'.`);

        // Read existing series from Google Sheet
        const existingRowsRaw = await getSheetRows('series');
        const existingHeader = existingRowsRaw[0] || [];
        const existingRows = existingRowsRaw.length > 1 ? existingRowsRaw.slice(1).map(r => ({
            Title: r[existingHeader.indexOf('Title')],
            SeriesTag: r[existingHeader.indexOf('SeriesTag')],
            DateRecorded: r[existingHeader.indexOf('DateRecorded')],
        })) : [];
        const allTitles = new Set(existingRows.map(r => r.Title));

        const result = await processSeriesRows(rows, existingRows, allTitles);
        processedCount = result.processedCount;
        skippedCount = result.skippedCount;

        logger.info(`Processed: ${processedCount}, Skipped: ${skippedCount}`);
        logger.summary(processedCount, skippedCount, 0);

        // Clear the global timeout since script completed successfully
        clearTimeout(globalTimeout);
    } catch (error) {
        clearTimeout(globalTimeout);
        handleError(logger, error instanceof Error ? error : new Error(String(error)), 'Error in beaconSeries.js', true);
    }
})();

/**
 * beaconSeries.js
 * Scrapes series film titles from The Beacon Cinema website.
 */

// @ts-check
// External dependencies
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const csvParser = require('csv-parser');

// Internal dependencies
const { ensureHeader, deduplicateRows, navigateWithRetry } = require('./utils');
const logger = require('./logger')('beaconSeries');
const { setupErrorHandling, handleError } = require('./errorHandler');

/** @typedef {import('./types').SeriesRow} SeriesRow */
/** @typedef {import('./types').SeriesIndexRow} SeriesIndexRow */

setupErrorHandling(logger, 'beaconSeries.js');

/**
 * Scrapes film titles from a series page
 * @param {string} seriesUrl - URL of the series page to scrape
 * @param {string} seriesTag - Tag identifying the series
 * @param {string} seriesCsvPath - Path to the series CSV file
 * @param {Set<string>} allTitles - Set of all known titles to avoid duplicates
 * @returns {Promise<SeriesRow[]>} Array of series records
 */
async function executeScript(seriesUrl, seriesTag, seriesCsvPath, allTitles) {
    // Parameter validation
    if (!seriesUrl || typeof seriesUrl !== 'string') {
        throw new Error('executeScript: seriesUrl must be a non-empty string');
    }
    if (!seriesTag || typeof seriesTag !== 'string') {
        throw new Error('executeScript: seriesTag must be a non-empty string');
    }
    if (!seriesCsvPath || typeof seriesCsvPath !== 'string') {
        throw new Error('executeScript: seriesCsvPath must be a non-empty string');
    }
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
 * Process series rows and write to series.csv
 * @param {SeriesIndexRow[]} rows - Array of series index rows
 * @param {SeriesRow[]} existingRows - Existing series records
 * @param {string} seriesCsvPath - Path to series CSV file
 * @param {Set<string>} allTitles - Set of all known titles
 * @param {string} seriesIndexCsvPath - Path to series index CSV file
 * @returns {Promise<{ processedCount: number; skippedCount: number }>}
 */
async function processSeriesRows(rows, existingRows, seriesCsvPath, allTitles, seriesIndexCsvPath) {
    // Parameter validation
    if (!rows || !Array.isArray(rows)) {
        throw new Error('processSeriesRows: rows must be an array');
    }
    if (!existingRows || !Array.isArray(existingRows)) {
        throw new Error('processSeriesRows: existingRows must be an array');
    }
    if (!seriesCsvPath || typeof seriesCsvPath !== 'string') {
        throw new Error('processSeriesRows: seriesCsvPath must be a non-empty string');
    }
    if (!allTitles || !(allTitles instanceof Set)) {
        throw new Error('processSeriesRows: allTitles must be a Set');
    }
    if (!seriesIndexCsvPath || typeof seriesIndexCsvPath !== 'string') {
        throw new Error('processSeriesRows: seriesIndexCsvPath must be a non-empty string');
    }
    
    let processedCount = 0;
    let skippedCount = 0;
    const totalRows = rows.length;

    try {
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            logger.info(`Processing ${i + 1}/${totalRows}: ${row.seriesName}`);
            
            const newRecords = await executeScript(row.seriesURL, row.seriesTag, seriesCsvPath, allTitles);
            processedCount += newRecords.length;
            skippedCount += newRecords.filter(r => allTitles.has(r.Title)).length;
            
            // Add new titles to set to prevent duplicates
            newRecords.forEach(record => allTitles.add(record.Title));
            
            // Update CSV file
            const csvWriter = createCsvWriter({
                path: seriesCsvPath,
                header: [
                    { id: 'Title', title: 'Title' },
                    { id: 'SeriesTag', title: 'SeriesTag' },
                    { id: 'DateRecorded', title: 'DateRecorded' }
                ],
                append: true
            });
            
            await csvWriter.writeRecords(newRecords);
            
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
        const seriesIndexCsvPath = path.join(__dirname, 'files', 'seriesIndex.csv');
        const seriesCsvPath = path.join(__dirname, 'files', 'series.csv');
        
        ensureHeader(seriesIndexCsvPath, 'seriesName,seriesURL,seriesTag');
        ensureHeader(seriesCsvPath, 'Title,SeriesTag,DateRecorded');
        
        /** @type {Array<{seriesName: string, seriesURL: string, seriesTag: string}>} */
        const rows = [];
        /** @type {Array<{Title: string, SeriesTag: string, DateRecorded: string}>} */
        const existingRows = [];
        const allTitles = new Set();
        
        /** @type {Promise<void>} */ 
        const loadPromise = new Promise((resolve, reject) => {
            fs.createReadStream(seriesIndexCsvPath)
                .pipe(csvParser())
                .on('data', (row) => {
                    if (row.seriesURL && row.seriesTag) rows.push(row);
                })
                .on('end', () => {
                    logger.info(`Found ${rows.length} series in ${seriesIndexCsvPath}.`);
                    resolve(undefined);
                })
                .on('error', reject);
        });
        
        await loadPromise;
        
        const result = await processSeriesRows(rows, existingRows, seriesCsvPath, allTitles, seriesIndexCsvPath);
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

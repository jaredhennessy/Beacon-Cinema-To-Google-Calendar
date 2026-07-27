
/**
 * beaconSeries.js
 * Scrapes series film titles from The Beacon Cinema website and updates Google Sheet 'series'.
 * Usage: node beaconSeries.js
 * - Reads Google Sheet 'seriesIndex' for the series pages to visit.
 * - Scrapes the films listed on each page.
 * - Replaces the rows for every scraped SeriesTag, so titles that are no longer listed
 *   are dropped. Tags absent from 'seriesIndex' keep their existing rows untouched, and
 *   a series that yields nothing keeps its rows rather than being emptied.
 * - Preserves each title's original DateRecorded as a first-seen timestamp.
 * - Writes the whole sheet once, at the end.
 * Dependencies: ./puppeteerConfig.js, ./sheetsUtils.js, ./utils.js, ./logger.js,
 *   ./errorHandler.js
 */

require('dotenv').config();

// @ts-check
// External dependencies
const { launchPuppeteerQuiet } = require('./puppeteerConfig');
const { getSheetRows, setSheetRows } = require('./sheetsUtils');

// Internal dependencies
const { deduplicateRows, navigateWithRetry } = require('./utils');
const logger = require('./logger')('beaconSeries');
const { setupErrorHandling, handleError } = require('./errorHandler');

/** @typedef {import('./types').SeriesRow} SeriesRow */
/** @typedef {import('./types').SeriesIndexRow} SeriesIndexRow */

setupErrorHandling(logger, 'beaconSeries.js');

// How many series to scrape before restarting Chrome. Override with SERIES_PER_BROWSER to
// trade speed for a lower memory ceiling without editing code — useful on a small instance.
//
// Chrome is launched with --single-process, so a closed page's memory stays in the browser
// process instead of being reclaimed when a renderer exits. Measured across 20 series:
//
//   per-series launch   20 startups   150 s   peak 278 MB
//   one browser          1 startup     33 s   peak 435 MB   (climbs ~13 MB per series)
//   recycle every 5      4 startups    46 s   peak 307 MB   (sawtooth, memory reclaimed)
//
// 278 MB is roughly the floor for one Chrome plus one page, so recycling lands within 10% of
// it while cutting runtime to a third. It also matters that each restart briefly holds two
// Chrome processes: 4 startups means 3 such windows instead of 19, which is what exhausted a
// 512 MB Render instance.
const SERIES_PER_BROWSER = Math.max(1, parseInt(process.env.SERIES_PER_BROWSER, 10) || 5);

/**
 * Rewrites legacy series URLs onto their current paths.
 * The site moved series and program pages out of /programs/entry/, which now only
 * serves a 308 redirect. Rewriting up front keeps the logs honest about what was
 * fetched and avoids depending on the redirect staying in place.
 * @param {string} seriesUrl - URL from the seriesIndex sheet
 * @returns {string} The URL to actually navigate to
 */
function normalizeSeriesUrl(seriesUrl) {
    // Parameter validation
    if (!seriesUrl || typeof seriesUrl !== 'string') {
        throw new Error('normalizeSeriesUrl: seriesUrl must be a non-empty string');
    }

    return seriesUrl.trim().replace(
        /^(https:\/\/thebeacon\.film)\/programs\/entry\//,
        '$1/programs/'
    );
}

/**
 * Scrapes film titles from a series or program page.
 *
 * Takes an already-running browser rather than launching its own. Launching per series
 * meant one Chrome process per seriesIndex row — 20 launch/teardown cycles on a typical
 * run — which exhausted the memory on a small Render instance and accounted for most of
 * the step's runtime. A page is opened and closed per series so pages cannot accumulate
 * across navigations, matching how findRuntimes.js iterates.
 *
 * @param {Object} browser - Puppeteer browser shared across all series
 * @param {string} seriesUrl - URL of the series page to scrape
 * @param {string} seriesTag - Tag identifying the series
 * @returns {Promise<SeriesRow[]>} Every film listed on the page, as series records
 */
async function executeScript(browser, seriesUrl, seriesTag) {
    // Parameter validation
    if (!browser || typeof browser !== 'object') {
        throw new Error('executeScript: browser must be a Puppeteer browser instance');
    }
    if (!seriesUrl || typeof seriesUrl !== 'string') {
        throw new Error('executeScript: seriesUrl must be a non-empty string');
    }
    if (!seriesTag || typeof seriesTag !== 'string') {
        throw new Error('executeScript: seriesTag must be a non-empty string');
    }

    const targetUrl = normalizeSeriesUrl(seriesUrl);
    if (targetUrl !== seriesUrl) {
        logger.warn(`Rewrote legacy series URL to ${targetUrl}. Update seriesURL in the seriesIndex sheet.`);
    }

    let page;
    try {
        page = await browser.newPage();

        const response = await navigateWithRetry(page, targetUrl, { logger });
        if (!response) {
            logger.error(`Failed to load ${targetUrl} after retries`);
            return [];
        }

        // A missing page still renders HTML, so without this check the 404 body's
        // headings get stored as film titles.
        const status = typeof response.status === 'function' ? response.status() : 200;
        if (status >= 400) {
            logger.error(`${targetUrl} returned HTTP ${status}; skipping series '${seriesTag}'.`);
            return [];
        }

        // Series and program pages list their films as `.film-title` inside
        // `.film-list`. The previous `h1, h2, h3` sweep also picked up the page
        // heading and the literal "Films in this Program" label, both of which
        // ended up stored as film titles.
        //
        // A seriesIndex row may also point straight at a film page rather than a
        // series page (the 'secret' blindfolded screenings do), which has no film
        // list — fall back to that page's own title.
        const titles = await page.evaluate(() => {
            const scoped = document.querySelectorAll('.film-list .film-title');
            const elements = scoped.length ? scoped : document.querySelectorAll('.film-title');
            if (elements.length) {
                return Array.from(elements).map(el => el.textContent?.trim()).filter(Boolean);
            }
            const ownTitle = document.querySelector('h1.movie-title')?.textContent?.trim();
            return ownTitle ? [ownTitle] : [];
        });

        if (titles.length === 0) {
            logger.warn(`No films found at ${targetUrl}. The website structure may have changed.`);
            return [];
        }

        logger.info(`Extracted ${titles.length} films for series '${seriesTag}'.`);

        const recordedAt = new Date().toISOString();
        return titles.map(title => ({
            Title: title,
            SeriesTag: seriesTag,
            DateRecorded: recordedAt
        }));
    } catch (error) {
        handleError(logger, error instanceof Error ? error : new Error(String(error)), `Error scraping series at ${targetUrl}`);
        return [];
    } finally {
        // Closed here so a mid-scrape failure cannot leak a page for the rest of the run.
        if (page) await page.close();
    }
}

/**
 * Scrapes every series and rewrites Google Sheet 'series' from the results.
 *
 * Each scraped SeriesTag has its rows replaced rather than appended to, which is
 * the behaviour the README documents and what clears out titles the old selector
 * captured by mistake. Tags absent from seriesIndex are preserved untouched, and a
 * series that yields nothing keeps its existing rows instead of being wiped. All
 * of it lands in a single write at the end rather than one write per series.
 *
 * Owns the single Puppeteer browser for the whole run and closes it as soon as scraping
 * finishes, so Chrome is not still resident while the sheet is written.
 *
 * @param {Array<{seriesName: string, seriesURL: string, seriesTag: string}>} rows
 * @param {Array<{Title: string, SeriesTag: string, DateRecorded: string}>} existingRows
 * @returns {Promise<{ processedCount: number; skippedCount: number }>} Counts of newly seen and already-known titles
 */
async function processSeriesRows(rows, existingRows) {
    // Parameter validation
    if (!rows || !Array.isArray(rows)) {
        throw new Error('processSeriesRows: rows must be an array');
    }
    if (!existingRows || !Array.isArray(existingRows)) {
        throw new Error('processSeriesRows: existingRows must be an array');
    }

    let processedCount = 0;
    let skippedCount = 0;
    const totalRows = rows.length;

    try {
        // Index what the sheet already holds so DateRecorded stays a first-seen
        // timestamp instead of being reset on every run.
        const knownByTag = new Map();
        for (const row of existingRows) {
            if (!row.Title || !row.SeriesTag) continue;
            if (!knownByTag.has(row.SeriesTag)) knownByTag.set(row.SeriesTag, new Map());
            knownByTag.get(row.SeriesTag).set(row.Title, row.DateRecorded);
        }

        const scrapedTags = new Set(rows.map(row => row.seriesTag));
        const preservedRows = existingRows.filter(row =>
            row.Title && row.SeriesTag && !scrapedTags.has(row.SeriesTag));

        const finalRecords = [];

        // One browser shared across a batch of series, recycled between batches to keep
        // Chrome's memory from accumulating. See SERIES_PER_BROWSER.
        let browser;
        try {
            for (let i = 0; i < rows.length; i++) {
                if (i % SERIES_PER_BROWSER === 0) {
                    if (browser) {
                        await browser.close();
                        logger.info(`Restarting Chrome after ${SERIES_PER_BROWSER} series to release memory.`);
                    }
                    browser = await launchPuppeteerQuiet();
                }

                const row = rows[i];
                logger.info(`Processing ${i + 1}/${totalRows}: ${row.seriesName}`);

                const records = await executeScript(browser, row.seriesURL, row.seriesTag);
                const known = knownByTag.get(row.seriesTag) || new Map();

                if (records.length === 0) {
                    logger.warn(`No films scraped for '${row.seriesTag}'; keeping its ${known.size} existing rows.`);
                    for (const [title, dateRecorded] of known) {
                        finalRecords.push({ Title: title, SeriesTag: row.seriesTag, DateRecorded: dateRecorded || '' });
                    }
                    logger.info(`Progress: ${i + 1}/${totalRows} complete. Found 0 films.`);
                    continue;
                }

                let newForSeries = 0;
                for (const record of records) {
                    if (known.has(record.Title)) {
                        skippedCount++;
                        finalRecords.push({ ...record, DateRecorded: known.get(record.Title) || record.DateRecorded });
                    } else {
                        newForSeries++;
                        processedCount++;
                        finalRecords.push(record);
                    }
                }

                logger.info(`Progress: ${i + 1}/${totalRows} complete. Found ${records.length} films (${newForSeries} new).`);
            }
        } finally {
            // Released before the sheet write so Chrome is not held open for it.
            if (browser) await browser.close();
        }

        const sheetRows = [
            ['Title', 'SeriesTag', 'DateRecorded'],
            ...preservedRows.map(row => [row.Title, row.SeriesTag, row.DateRecorded || '']),
            ...deduplicateRows(finalRecords, record => `${record.SeriesTag}|${record.Title}`)
                .map(record => [record.Title, record.SeriesTag, record.DateRecorded])
        ];
        await setSheetRows('series', sheetRows);
        logger.info(`series (Google Sheet) rewritten with ${sheetRows.length - 1} rows.`);

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

        const result = await processSeriesRows(rows, existingRows);
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

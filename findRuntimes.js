/**
 * findRuntimes.js
 * Extracts runtime information for events listed in Google Sheet 'schedule' and updates Google Sheet 'runtimes'.
 * Usage: node findRuntimes.js
 * - Prompts to replace runtimes (5s timeout, defaults to No). Answering Yes re-scrapes
 *   every scheduled film instead of skipping the ones already recorded.
 * - Reads Google Sheet 'schedule' for unique event URLs.
 * - Skips titles already present in Google Sheet 'runtimes' with a non-empty Runtime.
 * - Uses Puppeteer to extract runtime info from each URL.
 * - Merges newly scraped runtimes with the ones already in Google Sheet 'runtimes',
 *   so previously recorded values are not lost. Fresh values win on conflict.
 * Dependencies: ./puppeteerConfig.js, readline, ./sheetsUtils.js, ./utils.js,
 *   ./logger.js, ./errorHandler.js
 */

require('dotenv').config();

// External dependencies
const { launchPuppeteerQuiet } = require('./puppeteerConfig');
const { getSheetRows, setSheetRows } = require('./sheetsUtils');
const readline = require('readline');

// Internal dependencies
const { deduplicateRows, navigateWithRetry } = require('./utils');
const logger = require('./logger')('findRuntimes');
const { setupErrorHandling } = require('./errorHandler');

setupErrorHandling(logger, 'findRuntimes.js');

(async () => {
    logger.info('Starting findRuntimes.js');

    // Read schedule from Google Sheet
    const scheduleRowsRaw = await getSheetRows('schedule');
    const scheduleHeader = scheduleRowsRaw[0] || [];
    const scheduleRows = scheduleRowsRaw.length > 1 ? scheduleRowsRaw.slice(1).map(line => {
        return {
            Title: line[scheduleHeader.indexOf('Title')],
            URL: line[scheduleHeader.indexOf('URL')],
        };
    }).filter(row => row.Title && row.URL) : [];

    // Read runtimes from Google Sheet
    const runtimesRowsRaw = await getSheetRows('runtimes');
    const runtimesHeader = runtimesRowsRaw[0] || [];
    const runtimesRows = runtimesRowsRaw.length > 1 ? runtimesRowsRaw.slice(1).map(line => {
        return {
            Title: line[runtimesHeader.indexOf('Title')],
            Runtime: line[runtimesHeader.indexOf('Runtime')],
        };
    }).filter(row => row.Title && row.Runtime) : [];

    // Prompt user to replace runtimes (5s timeout)
    const shouldReplaceRuntimes = await new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        const timeout = setTimeout(() => {
            logger.info('No input received. Proceeding without replacing runtimes.');
            rl.close();
            resolve(false);
        }, 5000);

        rl.question('Replace existing runtimes? (Y/N): ', (answer) => {
            clearTimeout(timeout);
            rl.close();
            resolve(['y', 'yes'].includes(answer.toLowerCase().trim()));
        });
    });

    // Answering yes re-scrapes every film instead of skipping known ones.
    // Previously this answer was computed and then never consulted.
    const processedTitles = shouldReplaceRuntimes
        ? new Set()
        : new Set(runtimesRows.map(row => row.Title.trim()));
    if (shouldReplaceRuntimes) {
        logger.info('Replacing existing runtimes: every scheduled film will be re-scraped.');
    }

    // Collect URLs and titles from schedule sheet, skipping already processed
    const urls = new Map();
    const urlSet = new Set();
    let allSkippedForMissingFields = true;
    let duplicateTitleUrlFound = false;
    for (const row of scheduleRows) {
        if (!row || typeof row !== 'object') {
            logger.warn('Skipping malformed row in schedule sheet:', row);
            continue;
        }
        if (row.URL && row.Title && !processedTitles.has(row.Title.trim())) {
            allSkippedForMissingFields = false;
            const key = `${row.Title.trim()}|${row.URL}`;
            if (urlSet.has(key)) duplicateTitleUrlFound = true;
            urls.set(row.URL, row.Title.trim());
            urlSet.add(key);
        } else if (!row.URL || !row.Title) {
            logger.warn('Skipping row in schedule sheet with missing URL or Title:', row);
        }
    }
    if (duplicateTitleUrlFound) {
        logger.warn('Duplicate Title/URL pairs found in schedule sheet.');
    }
    if (allSkippedForMissingFields) {
        logger.warn('All URLs were skipped due to missing Title or URL.');
    }

    if (urls.size === 0) {
        logger.warn('No URLs to process after filtering. Exiting.');
        logger.info('Total runtimes processed: 0');
        return;
    }

    logger.info(`Found ${urls.size} unique URLs to process.`);

    let browser;
    const results = [];
    try {
        // Use centralized Puppeteer configuration
        browser = await launchPuppeteerQuiet();
        for (const [url, title] of urls.entries()) {
            logger.info(`Processing URL: ${url} for Title: ${title}`);
            const page = await browser.newPage();
            try {
                const navigationSuccess = await navigateWithRetry(page, url, { logger });
                if (!navigationSuccess) {
                    logger.error(`Failed to load ${url} after retries`);
                    results.push({ url, title, runtime: 'N/A' });
                    continue;
                }
                // Extract runtime from the film's detail page.
                // Film pages render metadata as `.meta-field` blocks pairing a
                // `.meta-label` with a `.meta-value`. The legacy fallback below
                // scanned every element in the document for the text "runtime",
                // which also matched any ancestor whose entire text was that word.
                const runtime = await page.evaluate(() => {
                    for (const field of document.querySelectorAll('.meta-field')) {
                        const label = field.querySelector('.meta-label')?.textContent.trim().toLowerCase();
                        if (label === 'runtime') {
                            return field.querySelector('.meta-value')?.textContent.trim() || null;
                        }
                    }
                    const legacy = Array.from(document.querySelectorAll('p, dt, span, strong, h4, h5'))
                        .find(el => el.textContent.trim().toLowerCase() === 'runtime');
                    return legacy?.nextElementSibling?.textContent.trim() || null;
                });
                if (runtime) {
                    logger.info(`Found Runtime: ${runtime} for Title: ${title}`);
                    results.push({ Title: title, Runtime: runtime });
                } else {
                    logger.warn(`Runtime not found for URL: ${url}`);
                }
            } catch (error) {
                if (error && error.message) {
                    logger.error(`Error processing URL: ${url} - ${error.message}`);
                    if (
                        error.message.includes('net::ERR_NAME_NOT_RESOLVED') ||
                        error.message.includes('Invalid URL') ||
                        error.message.includes('net::ERR_CONNECTION_REFUSED')
                    ) {
                        logger.error(`Navigation error: Unable to access "${url}".`);
                    }
                    if (error.message.includes('Navigation timeout')) {
                        logger.error(`Navigation timeout: "${url}" may be down or slow.`);
                    }
                    if (error.message.includes('404') || error.message.includes('500')) {
                        logger.error(`HTTP error (${error.message}) for "${url}".`);
                    }
                    if (error.stack && !error.message.includes('ENOENT')) {
                        logger.error(error.stack);
                    }
                } else {
                    logger.error(`Unknown error processing URL: ${url}`, error);
                }
            } finally {
                await page.close();
            }
        }
    } catch (error) {
        if (error && error.message) {
            logger.error('An error occurred while processing URLs:', error.message);
            if (error.stack && !error.message.includes('ENOENT')) {
                logger.error(error.stack);
            }
        } else {
            logger.error('An unknown error occurred while processing URLs:', error);
        }
    } finally {
        if (browser) await browser.close();
    }

    // Deduplicate newly scraped results by Title.
    const uniqueResults = deduplicateRows(results, rec => rec.Title);

    // Merge with what the sheet already holds. Writing only the new results would
    // discard every previously recorded runtime, since the sheet is replaced wholesale
    // and known titles are skipped above. Freshly scraped values win on conflict.
    const runtimesAdded = uniqueResults.length;
    const merged = deduplicateRows(
        [...uniqueResults, ...runtimesRows.map(row => ({ Title: row.Title, Runtime: row.Runtime }))],
        rec => rec.Title.trim()
    );

    if (merged.length === 0) {
        logger.warn('No runtimes to write. runtimes (Google Sheet) left unchanged.');
        if (!runtimesRowsRaw.length) {
            await setSheetRows('runtimes', [['Title', 'Runtime']]);
            logger.info('runtimes (Google Sheet) header written.');
        }
        logger.warn('No valid runtimes written for any event.');
    } else {
        const sheetRows = [
            ['Title', 'Runtime'],
            ...merged.map(event => [event.Title, event.Runtime])
        ];
        await setSheetRows('runtimes', sheetRows);
        logger.info(`Runtimes written to runtimes (Google Sheet): ${runtimesAdded} new, ${merged.length} total.`);
    }
    if (runtimesAdded === 0) {
        logger.info('No new runtimes found. Script completed successfully.');
    }
    // Output summary
    logger.info(`Total runtimes processed: ${runtimesAdded}`);
})().catch(err => {
    logger.error('Unhandled exception in findRuntimes.js:', err);
    logger.info('Total runtimes processed: 0');
});


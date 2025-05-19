/**
 * findRuntimes.js
 * Extracts runtime information for events listed in files/schedule.csv and updates files/runtimes.csv.
 * Usage: node findRuntimes.js
 * - Prompts to replace runtimes.csv (5s timeout).
 * - Reads files/schedule.csv for unique event URLs.
 * - Skips titles already present in files/runtimes.csv with a non-empty Runtime.
 * - Uses Puppeteer to extract runtime info from each URL.
 * - Writes results to files/runtimes.csv (Title, Runtime).
 * - Ensures header row exists in runtimes.csv.
 * Dependencies: puppeteer, csv-parser, csv-writer, readline, ./utils.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const readline = require('readline');
const { ensureHeader, deduplicateRows } = require('./utils');

process.on('unhandledRejection', (reason) => {
    console.error('[ERROR] Unhandled promise rejection in findRuntimes.js:', reason);
    console.log('[SUMMARY] Total runtimes processed: 0');
    process.exit(1);
});

(async () => {
    console.log('[START] findRuntimes.js');

    const scheduleCsvPath = path.join(__dirname, 'files', 'schedule.csv');
    const runtimesCsvPath = path.join(__dirname, 'files', 'runtimes.csv');

    if (!fs.existsSync(scheduleCsvPath)) {
        console.error(`[ERROR] ${scheduleCsvPath} does not exist.`);
        console.log('[SUMMARY] Total runtimes processed: 0');
        return;
    }

    ensureHeader(scheduleCsvPath, 'Title,Date,Time,URL,SeriesTag,DateRecorded');

    // Prompt user to replace runtimes.csv (5s timeout)
    const shouldReplaceRuntimes = await new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        const timeout = setTimeout(() => {
            console.log('[INFO] No input received. Proceeding without replacing runtimes.csv.');
            rl.close();
            resolve(false);
        }, 5000);
        rl.question('Replace existing runtimes? (Y/N)? ', (answer) => {
            clearTimeout(timeout);
            rl.close();
            resolve(answer.trim().toUpperCase() === 'Y');
        });
    });

    if (shouldReplaceRuntimes) {
        if (fs.existsSync(runtimesCsvPath)) {
            fs.unlinkSync(runtimesCsvPath);
            console.log('[INFO] Existing runtimes.csv deleted.');
        } else {
            console.warn('[WARN] No existing runtimes.csv to delete.');
        }
    }

    ensureHeader(runtimesCsvPath, 'Title,Runtime');

    const csvWriter = createCsvWriter({
        path: runtimesCsvPath,
        header: [
            { id: 'Title', title: 'Title' },
            { id: 'Runtime', title: 'Runtime' }
        ],
        append: true
    });

    // Collect processed titles from runtimes.csv
    const processedTitles = new Set();
    if (fs.existsSync(runtimesCsvPath)) {
        await new Promise((resolve, reject) => {
            fs.createReadStream(runtimesCsvPath)
                .pipe(csvParser())
                .on('data', (row) => {
                    if (row.Title && row.Runtime) {
                        processedTitles.add(row.Title.trim());
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });
    }

    // Collect URLs and titles from schedule.csv, skipping already processed
    const urls = new Map();
    const urlSet = new Set();
    let allSkippedForMissingFields = true;
    let duplicateTitleUrlFound = false;
    await new Promise((resolve, reject) => {
        fs.createReadStream(scheduleCsvPath)
            .pipe(csvParser())
            .on('data', (row) => {
                if (!row || typeof row !== 'object') {
                    console.warn('[WARN] Skipping malformed row in schedule.csv:', row);
                    return;
                }
                if (row.URL && row.Title && !processedTitles.has(row.Title.trim())) {
                    allSkippedForMissingFields = false;
                    const key = `${row.Title.trim()}|${row.URL}`;
                    if (urlSet.has(key)) duplicateTitleUrlFound = true;
                    urls.set(row.URL, row.Title.trim());
                    urlSet.add(key);
                } else if (!row.URL || !row.Title) {
                    console.warn('[WARN] Skipping row in schedule.csv with missing URL or Title:', row);
                }
            })
            .on('end', resolve)
            .on('error', reject);
    });
    if (duplicateTitleUrlFound) {
        console.warn('[WARN] Duplicate Title/URL pairs found in schedule.csv.');
    }
    if (allSkippedForMissingFields) {
        console.warn('[WARN] All URLs were skipped due to missing Title or URL.');
    }

    if (urls.size === 0) {
        console.warn('[WARN] No URLs to process after filtering. Exiting.');
        console.log('[SUMMARY] Total runtimes processed: 0');
        return;
    }

    console.log(`[INFO] Found ${urls.size} unique URLs to process.`);

    let browser;
    const results = [];
    try {
        browser = await puppeteer.launch();
        for (const [url, title] of urls.entries()) {
            console.log(`[INFO] Processing URL: ${url} for Title: ${title}`);
            const page = await browser.newPage();
            try {
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
                // Try to extract runtime from the page
                // The logic below attempts to find an element with the text "runtime" and retrieves the text of its sibling element.
                const runtime = await page.evaluate(() => {
                    const runtimeElement = Array.from(document.querySelectorAll('*'))
                        .find(el => el.textContent.trim().toLowerCase() === 'runtime');
                    if (runtimeElement) {
                        const nextParagraph = runtimeElement.nextElementSibling;
                        return nextParagraph ? nextParagraph.textContent.trim() : null;
                    }
                    return null;
                });
                if (runtime) {
                    console.log(`[INFO] Found Runtime: ${runtime} for Title: ${title}`);
                    results.push({ Title: title, Runtime: runtime });
                } else {
                    console.warn(`[WARN] Runtime not found for URL: ${url}`);
                }
            } catch (error) {
                if (error && error.message) {
                    console.error(`[ERROR] Error processing URL: ${url} - ${error.message}`);
                    if (
                        error.message.includes('net::ERR_NAME_NOT_RESOLVED') ||
                        error.message.includes('Invalid URL') ||
                        error.message.includes('net::ERR_CONNECTION_REFUSED')
                    ) {
                        console.error(`[ERROR] Navigation error: Unable to access "${url}".`);
                    }
                    if (error.message.includes('Navigation timeout')) {
                        console.error(`[ERROR] Navigation timeout: "${url}" may be down or slow.`);
                    }
                    if (error.message.includes('404') || error.message.includes('500')) {
                        console.error(`[ERROR] HTTP error (${error.message}) for "${url}".`);
                    }
                    if (error.stack && !error.message.includes('ENOENT')) {
                        console.error(error.stack);
                    }
                } else {
                    console.error(`[ERROR] Unknown error processing URL: ${url}`, error);
                }
            } finally {
                await page.close();
            }
        }
    } catch (error) {
        if (error && error.message) {
            console.error('[ERROR] An error occurred while processing URLs:', error.message);
            if (error.stack && !error.message.includes('ENOENT')) {
                console.error(error.stack);
            }
        } else {
            console.error('[ERROR] An unknown error occurred while processing URLs:', error);
        }
    } finally {
        if (browser) await browser.close();
    }

    // Deduplicate results by Title
    // This logic ensures that only unique titles are written to the CSV, avoiding duplicates.
    const uniqueResults = deduplicateRows(results, rec => rec.Title);

    let runtimesAdded = uniqueResults.length;
    if (uniqueResults.length === 0) {
        console.warn('[WARN] No unique runtimes to write. runtimes.csv not updated.');
        if (!fs.existsSync(runtimesCsvPath)) {
            await csvWriter.writeRecords([]);
            console.log('[INFO] runtimes.csv header written.');
        }
        console.log('[SUMMARY] No new runtimes were added to runtimes.csv.');
        console.warn('[WARN] No valid runtimes written for any event.');
    } else {
        await csvWriter.writeRecords(uniqueResults);
        console.log(`[INFO] Runtimes written to ${runtimesCsvPath} (${uniqueResults.length} new records).`);
        ensureHeader(runtimesCsvPath, 'Title,Runtime');
    }
    if (runtimesAdded === 0) {
        console.log('[INFO] No new runtimes found. Script completed successfully.');
    }
    // Output summary
    // The summary provides a concise overview of the script's execution, including the number of runtimes processed.
    console.log(`[SUMMARY] Total runtimes processed: ${runtimesAdded}`);
})().catch(err => {
    console.error('[ERROR] Unhandled exception in findRuntimes.js:', err);
    console.log('[SUMMARY] Total runtimes processed: 0');
});

/**
 * This script extracts runtime information for events listed in files/schedule.csv
 * and updates files/runtimes.csv.
 * - Prompts the user to decide whether to replace runtimes.csv (5s timeout).
 * - Reads files/schedule.csv to collect unique URLs for events.
 * - Skips titles already present in files/runtimes.csv with a non-empty Runtime value.
 * - Uses Puppeteer to browse to each URL and extract runtime information.
 * - Writes the extracted runtimes to files/runtimes.csv with fields: Title, Runtime.
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const readline = require('readline');

(async () => {
    const scheduleCsvPath = path.join(__dirname, 'files', 'schedule.csv');
    const runtimesCsvPath = path.join(__dirname, 'files', 'runtimes.csv');

    // Prompt the user to decide whether to replace runtimes.csv
    const shouldReplaceRuntimes = await new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const timeout = setTimeout(() => {
            console.log('No input received. Proceeding without replacing runtimes.csv.');
            rl.close();
            resolve(false); // Default to not replacing
        }, 5000); // 5-second timeout

        rl.question('Replace existing runtimes? (Y/N)? ', (answer) => {
            clearTimeout(timeout);
            rl.close();
            resolve(answer.trim().toUpperCase() === 'Y');
        });
    });

    if (shouldReplaceRuntimes && fs.existsSync(runtimesCsvPath)) {
        fs.unlinkSync(runtimesCsvPath);
        console.log('Existing runtimes.csv deleted.');
    }

    const csvWriter = createCsvWriter({
        path: runtimesCsvPath,
        header: [
            { id: 'Title', title: 'Title' },
            { id: 'Runtime', title: 'Runtime' }
        ],
        append: true // Append new records to the file
    });

    const urls = new Map(); // Map to store unique URLs and their corresponding titles
    const processedTitles = new Set(); // Set to track titles already processed with a non-empty Runtime

    // Read runtimes.csv to populate processedTitles
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

    // Read schedule.csv and collect unique URLs for titles not already processed
    if (fs.existsSync(scheduleCsvPath)) {
        await new Promise((resolve, reject) => {
            fs.createReadStream(scheduleCsvPath)
                .pipe(csvParser())
                .on('data', (row) => {
                    if (row.URL && row.Title && !processedTitles.has(row.Title.trim())) {
                        urls.set(row.URL, row.Title.trim());
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });
    } else {
        console.error(`Error: ${scheduleCsvPath} does not exist.`);
        return;
    }

    console.log(`Found ${urls.size} unique URLs to process.`);

    const browser = await puppeteer.launch();
    const results = [];

    try {
        for (const [url, title] of urls.entries()) {
            console.log(`Processing URL: ${url} for Title: ${title}`);
            const page = await browser.newPage();

            try {
                await page.goto(url, { waitUntil: 'networkidle2' });

                // Look for the word "Runtime" and grab the text from the next <p> tag
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
                    console.log(`Found Runtime: ${runtime} for Title: ${title}`);
                    results.push({ Title: title, Runtime: runtime });
                } else {
                    console.warn(`Runtime not found for URL: ${url}`);
                }
            } catch (error) {
                console.error(`Error processing URL: ${url}`, error.message);
            } finally {
                await page.close();
            }
        }
    } catch (error) {
        console.error('An error occurred while processing URLs:', error.message);
    } finally {
        await browser.close();
    }

    // Write results to runtimes.csv
    if (results.length > 0) {
        await csvWriter.writeRecords(results);
        console.log(`Runtimes written to ${runtimesCsvPath}`);
    } else {
        console.warn('No new runtimes found. No data written to runtimes.csv.');
    }
})();

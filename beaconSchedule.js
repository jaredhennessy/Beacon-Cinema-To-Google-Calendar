/**
 * beaconSchedule.js
 * Scrapes event data from The Beacon Film Calendar and updates files/schedule.csv.
 * Usage: node beaconSchedule.js
 * - Optionally runs beaconSeries.js to update files/series.csv before scraping.
 * - Scrapes event titles, dates, times, and URLs from the calendar page.
 * - Matches titles with SeriesTag from files/series.csv.
 * - Adds a DateRecorded timestamp to each record.
 * - Removes past screenings from files/schedule.csv before writing new data.
 * - Writes the updated schedule to files/schedule.csv.
 * - Ensures header rows in all CSVs.
 * Dependencies: puppeteer, csv-writer, readline, ./utils.js
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const readline = require('readline');
const { ensureHeader, deduplicateRows } = require('./utils');

process.on('unhandledRejection', (reason) => {
    console.error('[ERROR] Unhandled promise rejection in beaconSchedule.js:', reason);
    console.log('[SUMMARY] Total events processed: 0');
    process.exit(1);
});

(async () => {
    console.log('[START] beaconSchedule.js');

    const calendarUrl = 'https://thebeacon.film/calendar';
    const seriesCsvPath = path.join(__dirname, 'files', 'series.csv');
    const scheduleCsvPath = path.join(__dirname, 'files', 'schedule.csv');
    const seriesIndexCsvPath = path.join(__dirname, 'files', 'seriesIndex.csv');

    ensureHeader(seriesCsvPath, 'Title,SeriesTag,DateRecorded');
    ensureHeader(scheduleCsvPath, 'Title,Date,Time,URL,SeriesTag,DateRecorded');
    ensureHeader(seriesIndexCsvPath, 'seriesName,seriesURL,seriesTag');

    if (!fs.existsSync(seriesCsvPath)) {
        console.error('[ERROR] files/series.csv is missing. Please run beaconSeries.js first.');
        console.log('[SUMMARY] Total events processed: 0');
        console.log('[SUMMARY] beaconSchedule.js finished. Total events processed: 0');
        return;
    }

    const scheduleCsvWriter = createCsvWriter({
        path: scheduleCsvPath,
        header: [
            { id: 'title', title: 'Title' },
            { id: 'date', title: 'Date' },
            { id: 'time', title: 'Time' },
            { id: 'url', title: 'URL' },
            { id: 'seriesTag', title: 'SeriesTag' },
            { id: 'dateRecorded', title: 'DateRecorded' }
        ]
    });

    const normalizeTitle = title => title.replace(/^"|"$/g, '').trim().toLowerCase();

    let browser;
    let eventsAdded = 0;
    try {
        browser = await puppeteer.launch();
        const page = await browser.newPage();

        await page.goto(calendarUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        // Extract event titles from the page
        const titles = await page.evaluate(() => {
            const titleElements = document.querySelectorAll('section[itemprop="name"]');
            const titles = Array.from(titleElements).map(el => el.textContent.trim());
            return [...new Set(titles)];
        });

        if (!Array.isArray(titles) || titles.length === 0) {
            console.info('[INFO] No event titles found on the calendar page.');
            console.warn('[WARN] No titles found on the calendar page. The website structure may have changed.');
        }

        const titleMap = new Map(
            titles.map(title => [normalizeTitle(title), title.trim()])
        );
        titleMap.delete(normalizeTitle('RENT THE BEACON'));

        const seriesRows = fs.readFileSync(seriesCsvPath, 'utf8')
            .split('\n')
            .slice(1)
            .map(line => {
                const fields = line.split(',').map(field => field.trim());
                if (fields.length < 3) {
                    console.warn('[WARN] Skipping malformed row in series.csv:', line);
                    return [];
                }
                return fields;
            })
            .filter(fields => fields.length >= 3);

        const seenPairs = new Set();
        for (const [title, seriesTag] of seriesRows) {
            const key = `${title}|${seriesTag}`;
            if (seenPairs.has(key)) {
                console.warn(`[WARN] Duplicate Title/SeriesTag pair "${title}|${seriesTag}" found in series.csv.`);
            }
            seenPairs.add(key);
        }
        const seriesMap = new Map(seriesRows.map(([title, seriesTag]) => [normalizeTitle(title), seriesTag]));

        console.log('[INFO] Extracted titles:', Array.from(titleMap.values()));

        // Scrape schedule data from the page
        const schedule = await page.evaluate(() => {
            const scheduleList = [];
            const eventBlocks = document.querySelectorAll('section[itemprop="name"]');
            if (eventBlocks.length === 0) {
                console.warn('[WARN] No event blocks found. The website structure may have changed.');
            }
            eventBlocks.forEach(eventBlock => {
                const title = eventBlock.textContent.trim();
                const url = eventBlock.closest('a')?.href || '';
                const timeElements = Array.from(eventBlock.parentElement.querySelectorAll('section.time[itemprop="startDate"]'));
                timeElements.forEach(timeElement => {
                    const startDate = timeElement.getAttribute('content');
                    if (startDate) {
                        const [date, time] = startDate.split('T');
                        const formattedDate = date;
                        const formattedTime = time.slice(0, 5);
                        scheduleList.push({ title, date: formattedDate, time: formattedTime, url });
                    }
                });
            });
            return scheduleList;
        });

        if (!Array.isArray(schedule) || schedule.length === 0) {
            console.info('[INFO] No schedule data found on the calendar page.');
            console.warn('[WARN] No schedule data found on the calendar page. The website structure may have changed.');
        }

        const today = new Date().toISOString().split('T')[0];
        const existingSchedule = fs.existsSync(scheduleCsvPath)
            ? fs.readFileSync(scheduleCsvPath, 'utf8')
                  .split('\n')
                  .slice(1)
                  .map(line => line.split(',').map(field => field.trim()))
                  .filter(fields => fields.length >= 2)
            : [];

        // Remove future screenings from schedule.csv before writing new data
        const filteredSchedule = existingSchedule.filter(([title, date]) => date < today);

        const tempScheduleCsvWriter = createCsvWriter({
            path: scheduleCsvPath,
            header: [
                { id: 'title', title: 'Title' },
                { id: 'date', title: 'Date' },
                { id: 'time', title: 'Time' },
                { id: 'url', title: 'URL' },
                { id: 'seriesTag', title: 'SeriesTag' },
                { id: 'dateRecorded', title: 'DateRecorded' }
            ]
        });

        await tempScheduleCsvWriter.writeRecords(
            filteredSchedule.map(([title, date, time, url, seriesTag, dateRecorded]) => ({
                title,
                date,
                time,
                url,
                seriesTag,
                dateRecorded
            }))
        );
        console.log('[INFO] Removed future screenings from schedule.csv.');

        const currentTimestamp = new Date().toISOString();
        const scheduleWithSeriesTag = schedule
            .filter(event => event.title !== 'RENT THE BEACON')
            .filter(event => event.title && event.date && event.time)
            .map(event => ({
                ...event,
                seriesTag: seriesMap.get(normalizeTitle(event.title)) || '',
                dateRecorded: currentTimestamp,
                url: event.url
            }));

        if (scheduleWithSeriesTag.length === 0) {
            console.warn('[WARN] All events were skipped due to missing required fields.');
            console.log('[SUMMARY] No valid events were written to schedule.csv.');
        }

        // Deduplicate events by title/date/time
        let uniqueEvents = deduplicateRows(scheduleWithSeriesTag, event => `${event.title}|${event.date}|${event.time}`);
        let duplicateWritten = uniqueEvents.length < scheduleWithSeriesTag.length;

        if (duplicateWritten) {
            console.warn('[WARN] Duplicate events found in final written schedule.');
        }

        if (uniqueEvents.length === 0) {
            console.warn('[WARN] No unique events to write. schedule.csv not updated.');
            console.log('[SUMMARY] No new events were added to schedule.csv.');
        } else {
            await scheduleCsvWriter.writeRecords(
                uniqueEvents.map(event => ({
                    ...event,
                    title: titleMap.get(normalizeTitle(event.title)) || event.title
                }))
            );
            console.log(`[INFO] schedule.csv written successfully. ${uniqueEvents.length} events added.`);
            // Ensure header after writing
            ensureHeader(scheduleCsvPath, 'Title,Date,Time,URL,SeriesTag,DateRecorded');
        }
        eventsAdded = uniqueEvents.length;
        console.log(`[SUMMARY] Total events processed: ${eventsAdded}`);

    } catch (error) {
        if (error && error.message) {
            console.error('[ERROR] An error occurred:', error.message);
            if (error.stack && !error.message.includes('ENOENT')) {
                console.error(error.stack);
            }
            if (error.message.includes('no such file or directory') && error.message.includes('series.csv')) {
                console.error('[ERROR] files/series.csv is missing. Please run beaconSeries.js first.');
            }
        } else {
            console.error('[ERROR] An unknown error occurred:', error);
        }
        console.log(`[SUMMARY] Total events processed: ${eventsAdded}`);
    } finally {
        if (browser) await browser.close();
        console.log(`[SUMMARY] beaconSchedule.js finished. Total events processed: ${eventsAdded}`);
    }
})().catch(err => {
    console.error('[ERROR] Unhandled exception in beaconSchedule.js:', err);
    console.log('[SUMMARY] Total events processed: 0');
});
/**
 * beaconSchedule.js
 * Scrapes event data from The Beacon Film Calendar and updates Google Sheet 'schedule'.
 * Usage: node beaconSchedule.js
 * - Scrapes event titles, dates, times, and URLs from the calendar page.
 * - Matches titles with SeriesTag from Google Sheet 'series'.
 * - Adds a DateRecorded timestamp to each record.
 * - Removes past screenings from Google Sheet 'schedule' before writing new data.
 * - Writes the updated schedule to Google Sheet 'schedule'.
 * - Ensures header rows in all Google Sheets.
 * Dependencies: puppeteer, readline, ./utils.js, ./sheetsUtils.js
 */

require('dotenv').config();

// External dependencies
const puppeteer = require('puppeteer');
const { getSheetRows, setSheetRows } = require('./sheetsUtils');

// Internal dependencies
const logger = require('./logger')('beaconSchedule');
const { deduplicateRows, navigateWithRetry } = require('./utils');
const { setupErrorHandling, handleError } = require('./errorHandler');

// const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/opt/render/.cache/puppeteer/chrome/linux-135.0.7049.84/chrome-linux64/chrome';

setupErrorHandling(logger, 'beaconSchedule.js');

(async () => {
    logger.info('Starting beaconSchedule.js');

    const calendarUrl = 'https://thebeacon.film/calendar';
    // Read series from Google Sheet
    const seriesRowsRaw = await getSheetRows('series');
    const seriesHeader = seriesRowsRaw[0] || [];
    const seriesRows = seriesRowsRaw.length > 1 ? seriesRowsRaw.slice(1).map(line => {
        return [
            line[seriesHeader.indexOf('Title')],
            line[seriesHeader.indexOf('SeriesTag')],
            line[seriesHeader.indexOf('DateRecorded')]
        ];
    }).filter(fields => fields[0] && fields[1]) : [];

    const normalizeTitle = title => title.replace(/^"|"$/g, '').trim().toLowerCase();

    let browser;
    let eventsAdded = 0;
    try {
        // Render.com: Let Puppeteer manage its own browser installation. See https://community.render.com/t/error-could-not-found-chromium/9848
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ]
        });
        const page = await browser.newPage();

        const navigationSuccess = await navigateWithRetry(page, calendarUrl, { logger });
        if (!navigationSuccess) {
            logger.error('Failed to load calendar page after retries');
            return;
        }
        // Extract event titles from the page
        const titles = await page.evaluate(() => {
            const titleElements = document.querySelectorAll('section[itemprop="name"]');
            const titles = Array.from(titleElements).map(el => el.textContent.trim());
            return [...new Set(titles)];
        });

        if (!Array.isArray(titles) || titles.length === 0) {
            logger.warn('No titles found on the calendar page. The website structure may have changed.');
        }

        const titleMap = new Map(
            titles.map(title => [normalizeTitle(title), title.trim()])
        );
        titleMap.delete(normalizeTitle('RENT THE BEACON'));

    const seriesRows = await getSheetRows('series');
    const seriesMapFromSheet = new Map(seriesRows.map(([title, seriesTag]) => [normalizeTitle(title), seriesTag]));

        const seenPairs = new Set();
        for (const [title, seriesTag] of seriesRows) {
            const key = `${title}|${seriesTag}`;
            if (seenPairs.has(key)) {
                logger.warn(`Duplicate Title/SeriesTag pair "${title}|${seriesTag}" found in series.csv.`);
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
                logger.warn('No event blocks found. The website structure may have changed.');
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
            logger.warn('No schedule data found on the calendar page. The website structure may have changed.');
            logger.info('No schedule data found on the calendar page.');
        }

        const today = new Date().toISOString().split('T')[0];
        // Read existing schedule from Google Sheet
    const scheduleRows = await getSheetRows('schedule');
    const scheduleHeader = scheduleRows[0] || [];
    const validScheduleRows = scheduleRows.length > 1 ? scheduleRows.slice(1).filter(fields => fields[0] && fields[1]) : [];

        // Remove future screenings from schedule before writing new data
        const filteredSchedule = validScheduleRows.filter(([title, date]) => date < today);

        // Write filtered schedule back to Google Sheet
        let filteredRows = [scheduleHeader];
        for (const row of filteredSchedule) {
            filteredRows.push(row);
        }
        await setSheetRows('schedule', filteredRows);
        logger.info('Removed future screenings from schedule (Google Sheet).');

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
            logger.warn('All events were skipped due to missing required fields.');
            logger.info('No valid events were written to schedule.csv.');
        }

        // Deduplicate events by title/date/time
        const uniqueEvents = deduplicateRows(scheduleWithSeriesTag, event => `${event.title}|${event.date}|${event.time}`);
        const duplicateWritten = uniqueEvents.length < scheduleWithSeriesTag.length;

        if (duplicateWritten) {
            logger.warn('Duplicate events found in final written schedule.');
        }

        if (uniqueEvents.length === 0) {
            logger.warn('No unique events to write. schedule (Google Sheet) not updated.');
            logger.info('No new events were added to schedule (Google Sheet).');
        } else {
            // Write unique events to Google Sheet
            const sheetRows = [
                ['Title', 'Date', 'Time', 'URL', 'SeriesTag', 'DateRecorded'],
                ...uniqueEvents.map(event => [
                    titleMap.get(normalizeTitle(event.title)) || event.title,
                    event.date,
                    event.time,
                    event.url,
                    event.seriesTag,
                    event.dateRecorded
                ])
            ];
            await setSheetRows('schedule', sheetRows);
            logger.info(`schedule (Google Sheet) written successfully. ${uniqueEvents.length} events added.`);
        }
        eventsAdded = uniqueEvents.length;
        logger.info(`Total events processed: ${eventsAdded}`);

    } catch (error) {
        if (error && error.message) {
            logger.error('An error occurred:', error.message);
            if (error.stack && !error.message.includes('ENOENT')) {
                logger.error(error.stack);
            }
            if (error.message.includes('no such file or directory') && error.message.includes('series.csv')) {
                logger.error('files/series.csv is missing. Please run beaconSeries.js first.');
            }
        } else {
            logger.error('An unknown error occurred:', error);
        }
        logger.info(`Total events processed: ${eventsAdded}`);
    } finally {
        if (browser) await browser.close();
        logger.info(`beaconSchedule.js finished. Total events processed: ${eventsAdded}`);
    }
})().catch(err => {
    logger.error('Unhandled exception in beaconSchedule.js:', err);
    logger.info('Total events processed: 0');
});
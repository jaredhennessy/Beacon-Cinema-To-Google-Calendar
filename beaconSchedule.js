/**
 * beaconSchedule.js
 * Scrapes event data from The Beacon Film Calendar and updates Google Sheet 'schedule'.
 * Usage: node beaconSchedule.js
 * - Scrapes event titles, dates, times, and URLs from the calendar page.
 * - Reconstructs each date/time: the page has no ISO datetimes and no year at all.
 * - Excludes theater rentals, which are marked by CSS class rather than by title.
 * - Matches titles with SeriesTag from Google Sheet 'series'.
 * - Adds a DateRecorded timestamp to each record.
 * - Replaces Google Sheet 'schedule' with the scraped window, dropping past screenings.
 *   The sheet is left untouched when nothing could be scraped.
 * Dependencies: ./puppeteerConfig.js, ./sheetsUtils.js, ./utils.js, ./logger.js, ./errorHandler.js
 */

require('dotenv').config();

// External dependencies
const { launchPuppeteerQuiet } = require('./puppeteerConfig');
const { getSheetRows, setSheetRows } = require('./sheetsUtils');

// Internal dependencies
const logger = require('./logger')('beaconSchedule');
const { deduplicateRows, navigateWithRetry, parseCalendarDate, parseTime12h } = require('./utils');
const { setupErrorHandling } = require('./errorHandler');

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
        // Use centralized Puppeteer configuration
        browser = await launchPuppeteerQuiet();
        const page = await browser.newPage();

        const navigationSuccess = await navigateWithRetry(page, calendarUrl, { logger });
        if (!navigationSuccess) {
            logger.error('Failed to load calendar page after retries');
            return;
        }

        const seenPairs = new Set();
        for (const [title, seriesTag] of seriesRows) {
            const key = `${normalizeTitle(title)}|${seriesTag}`;
            if (seenPairs.has(key)) {
                logger.warn(`Duplicate Title/SeriesTag pair "${title}|${seriesTag}" found in the series sheet.`);
            }
            seenPairs.add(key);
        }
        const seriesMap = new Map(seriesRows.map(([title, seriesTag]) => [normalizeTitle(title), seriesTag]));

        // Scrape showtimes from the page.
        //
        // The site renders every showtime twice: once in the desktop `.cal-grid`
        // and once in the mobile `.cal-list`. Both are always present in the HTML
        // (a CSS media query hides one), so scraping generically would double
        // every event. The list view is the better target because its parent day
        // carries a complete "Saturday, July 25" label, whereas the grid only has
        // a bare day number that has to be paired with the month heading.
        //
        // Note there is no ISO datetime anywhere on the page any more, and no year
        // at all: dates and times are reconstructed in Node, below.
        const rawEntries = await page.evaluate(() => {
            const entries = [];
            document.querySelectorAll('.cal-list .cal-list-day').forEach(day => {
                const dayLabel = day.querySelector('.cal-list-date')?.textContent.trim() || '';
                day.querySelectorAll('.cal-list-entry').forEach(entry => {
                    const link = entry.querySelector('a.cal-list-movie');
                    if (!link) return;
                    entries.push({
                        dayLabel,
                        title: link.textContent.trim(),
                        // `.href` resolves the relative /calendar/movie/<slug> path.
                        url: link.href,
                        timeText: entry.querySelector('.cal-list-time')?.textContent.trim() || '',
                        // Theater rentals are marked by class; matching on the title
                        // is unreliable because its casing changes between views.
                        isRental: entry.classList.contains('cal-list-entry-rental'),
                        // Stable Square catalog id, unique per showtime.
                        catalogId: entry.querySelector('[data-catalog-id]')?.getAttribute('data-catalog-id') || ''
                    });
                });
            });
            return entries;
        });

        if (rawEntries.length === 0) {
            logger.warn('No calendar entries found on the calendar page. The website structure may have changed.');
        }

        const filmEntries = rawEntries.filter(entry => !entry.isRental);
        logger.info(`Found ${rawEntries.length} calendar entries (${rawEntries.length - filmEntries.length} rentals excluded).`);

        // Rebuild each showtime into YYYY-MM-DD / HH:MM.
        const referenceDate = new Date();
        const schedule = [];
        for (const entry of filmEntries) {
            const date = entry.dayLabel ? parseCalendarDate(entry.dayLabel, referenceDate) : null;
            const time = entry.timeText ? parseTime12h(entry.timeText) : null;
            if (!entry.title || !date || !time) {
                logger.warn(`Skipping entry with missing or unparseable fields: ${JSON.stringify(entry)}`);
                continue;
            }
            schedule.push({
                title: entry.title,
                date,
                time,
                url: entry.url,
                catalogId: entry.catalogId
            });
        }

        if (schedule.length === 0) {
            logger.warn('No schedule data could be parsed from the calendar page. The website structure may have changed.');
        }

        const currentTimestamp = new Date().toISOString();
        const scheduleWithSeriesTag = schedule.map(event => ({
            ...event,
            seriesTag: seriesMap.get(normalizeTitle(event.title)) || '',
            dateRecorded: currentTimestamp
        }));

        // Deduplicate by catalog id where the site provides one, since it identifies
        // a showtime exactly; fall back to title/date/time otherwise.
        const uniqueEvents = deduplicateRows(
            scheduleWithSeriesTag,
            event => event.catalogId || `${normalizeTitle(event.title)}|${event.date}|${event.time}`
        );
        const duplicateWritten = uniqueEvents.length < scheduleWithSeriesTag.length;

        if (duplicateWritten) {
            logger.warn('Duplicate events found in final written schedule.');
        }

        if (uniqueEvents.length === 0) {
            // Leaving the sheet untouched is deliberate: blanking it on a failed
            // scrape would wipe the calendar on the next updateGCal run.
            logger.warn('No unique events to write. schedule (Google Sheet) left unchanged.');
            logger.info('No new events were added to schedule (Google Sheet).');
        } else {
            // Replaces the whole sheet, which drops past screenings as documented.
            const sheetRows = [
                ['Title', 'Date', 'Time', 'URL', 'SeriesTag', 'DateRecorded'],
                ...uniqueEvents.map(event => [
                    event.title,
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
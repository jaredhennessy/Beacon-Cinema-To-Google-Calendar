/**
 * updateGCal.js
 * Synchronizes The Beacon Cinema schedule (from Google Sheet 'schedule') with a Google Calendar.
 * 
 * Usage: node updateGCal.js
 * 
 * Operations:
 * - Reads Google Sheets 'schedule', 'runtimes' and 'seriesIndex' (read-only)
 * - Skips rows dated before today, then deletes all upcoming events from the calendar
 * - Creates new events with runtime and series info if available
 * - Uses service account authentication (no OAuth2 or tokens needed)
 * - Provides error handling and clear output messages
 *
 * Required environment variables:
 * - Service account credentials (see .env)
 * - CALENDAR_ID
 *
 * Dependencies: googleapis, dotenv, ./gcalAuth.js, ./sheetsUtils.js, ./utils.js,
 *   ./logger.js, ./errorHandler.js
 */

require('dotenv').config();

// External dependencies
const { google } = require('googleapis');
const { getSheetRows } = require('./sheetsUtils');

// Internal dependencies
const { getServiceAccountClient } = require('./gcalAuth');
const { deduplicateRows, addDaysToISODate } = require('./utils');
const { titleCase } = require('./titleCase');
const logger = require('./logger')('updateGCal');
const { setupErrorHandling } = require('./errorHandler');

const TIME_ZONE = process.env.TIME_ZONE || 'America/Los_Angeles';

setupErrorHandling(logger, 'updateGCal.js');

if (!process.env.CALENDAR_ID) {
    logger.error('CALENDAR_ID must be set in your .env file.');
    process.exit(1);
}

/**
 * Connects to Google Calendar and processes the schedule update workflow
 * @returns {Promise<void>}
 */
async function connectToCalendar() {
    logger.info('Starting updateGCal.js');
    try {
        // Authenticate using service account
        const serviceAccountClient = getServiceAccountClient();
        const calendar = google.calendar({ version: 'v3', auth: serviceAccountClient });

        // Read runtimes from Google Sheet
        const runtimesRowsRaw = await getSheetRows('runtimes');
        const runtimesHeader = runtimesRowsRaw[0] || [];
        const runtimesMap = new Map();
        if (runtimesRowsRaw.length > 1) {
            for (const line of runtimesRowsRaw.slice(1)) {
                const title = line[runtimesHeader.indexOf('Title')];
                const runtime = line[runtimesHeader.indexOf('Runtime')];
                if (title && runtime) runtimesMap.set(title.trim(), runtime.trim());
            }
        }

        // Read seriesIndex from Google Sheet
        const seriesIndexRowsRaw = await getSheetRows('seriesIndex');
        const seriesIndexHeader = seriesIndexRowsRaw[0] || [];
        const seriesMap = new Map();
        if (seriesIndexRowsRaw.length > 1) {
            for (const line of seriesIndexRowsRaw.slice(1)) {
                const seriesTag = line[seriesIndexHeader.indexOf('seriesTag')];
                const seriesName = line[seriesIndexHeader.indexOf('seriesName')];
                if (seriesTag && seriesName) seriesMap.set(seriesTag.trim(), seriesName.trim());
            }
        }

        // Read schedule from Google Sheet
        const scheduleRowsRaw = await getSheetRows('schedule');
        const scheduleHeader = scheduleRowsRaw[0] || [];
        const eventsToCreate = [];
        const today = new Date().toISOString().split('T')[0];

        let allSkippedForMissingFields = true;
        let duplicateEventFound = false;
        const eventKeys = new Set();
        for (const line of scheduleRowsRaw.slice(1)) {
            const row = {
                Title: line[scheduleHeader.indexOf('Title')],
                Date: line[scheduleHeader.indexOf('Date')],
                Time: line[scheduleHeader.indexOf('Time')],
                URL: line[scheduleHeader.indexOf('URL')],
                SeriesTag: line[scheduleHeader.indexOf('SeriesTag')],
            };
            if (!row || typeof row !== 'object') {
                logger.warn('Skipping malformed row in schedule sheet:', row);
                continue;
            }
            if (!row.Date || !row.Time || !row.Title) {
                logger.warn(`Skipping invalid row in schedule sheet (missing required fields): ${JSON.stringify(row)}`);
                continue;
            }
            allSkippedForMissingFields = false;
            if (row.Date < today) {
                logger.info(`Skipping past event: ${row.Title} on ${row.Date}`);
                continue;
            }
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(row.Date)) {
                logger.error(`Invalid date format for event "${row.Title}": ${row.Date}. Expected YYYY-MM-DD.`);
                continue;
            }
            const timeRegex = /^\d{2}:\d{2}$/;
            if (!timeRegex.test(row.Time)) {
                logger.error(`Invalid time format for event "${row.Title}": ${row.Time}. Expected HH:MM (24-hour).`);
                continue;
            }
            const formattedTitle = titleCase(row.Title);
            const formattedSeriesName = row.SeriesTag && seriesMap.has(row.SeriesTag)
                ? titleCase(seriesMap.get(row.SeriesTag))
                : '';

            const descriptionParts = [];
            const runtimeValue = runtimesMap.get(row.Title) || runtimesMap.get(row.Title.trim());
            if (runtimeValue) descriptionParts.push(`Runtime: ${runtimeValue}`);
            if (formattedSeriesName) descriptionParts.push(`Film Series: ${formattedSeriesName}`);
            if (row.URL) descriptionParts.push(`URL: ${row.URL}`);
            const description = descriptionParts.join('\n');

            // Create datetime strings in the correct format for Google Calendar API
            // When specifying timeZone, Google expects format: YYYY-MM-DDTHH:MM:SS
            const startDateTimeString = `${row.Date}T${row.Time}:00`;

            // Calculate end time. Runtime plus 15 minutes when known, otherwise
            // a 2 hour default.
            const runtimeMatch = runtimeValue && runtimeValue.match(/^(\d+)\s*minutes$/i);
            const durationMinutes = runtimeMatch ? parseInt(runtimeMatch[1], 10) + 15 : 120;

            // Done in plain minutes so a late show running past midnight rolls the
            // date forward. Reusing row.Date for the end produced a timestamp
            // earlier than the start, which the API rejects — and the calendar
            // regularly carries 10:00 PM showtimes.
            const [startHours, startMinutes] = row.Time.split(':').map(Number);
            const endTotalMinutes = startHours * 60 + startMinutes + durationMinutes;
            const endDate = addDaysToISODate(row.Date, Math.floor(endTotalMinutes / 1440));
            const endHours = String(Math.floor((endTotalMinutes % 1440) / 60)).padStart(2, '0');
            const endMinutes = String(endTotalMinutes % 60).padStart(2, '0');
            const endDateTimeString = `${endDate}T${endHours}:${endMinutes}:00`;

            const key = `${row.Title}|${row.Date}|${row.Time}`;
            if (eventKeys.has(key)) duplicateEventFound = true;
            eventKeys.add(key);

            eventsToCreate.push({
                summary: formattedTitle,
                start: {
                    dateTime: startDateTimeString,
                    timeZone: TIME_ZONE,
                },
                end: {
                    dateTime: endDateTimeString,
                    timeZone: TIME_ZONE,
                },
                location: "The Beacon Cinema, 4405 Rainier Ave S, Seattle, WA 98118, USA",
                description,
            });
        }

        if (duplicateEventFound) {
            logger.warn('Duplicate events (by Title/Date/Time) found in the schedule sheet.');
        }
        if (allSkippedForMissingFields) {
            logger.warn('All events were skipped due to missing required fields.');
        }

        if (eventsToCreate.length === 0) {
            logger.warn('No events to create after parsing the schedule sheet. Exiting.');
            return;
        }

        // Deduplicate events by summary/start time
        const uniqueEventsToCreate = deduplicateRows(eventsToCreate, event => `${event.summary}|${event.start.dateTime}`);
        const duplicateWritten = uniqueEventsToCreate.length < eventsToCreate.length;

        if (duplicateWritten) {
            logger.warn('Duplicate events found in final uniqueEventsToCreate.');
        }
        if (uniqueEventsToCreate.length === 0) {
            logger.error('No valid events to create. Exiting without deleting existing events.');
            logger.warn('No valid events were written to Google Calendar.');
            return;
        }

        logger.info(`Creating ${uniqueEventsToCreate.length} events.`);
        await deleteUpcomingEvents(calendar);

        let successCount = 0;
        let failureCount = 0;

        for (const event of uniqueEventsToCreate) {
            try {
                await calendar.events.insert({
                    calendarId: process.env.CALENDAR_ID,
                    resource: event,
                });
                successCount++;
                console.log(`[INFO] Event created (${successCount}/${uniqueEventsToCreate.length}): ${event.summary}`);
            } catch (error) {
                logger.error(`Failed to create event: ${event.summary}`, error.message);
                // Add troubleshooting steps for common auth errors
                if (
                    error &&
                    error.message &&
                    (
                        error.message.includes('No refresh token is set') ||
                        error.message.includes('invalid_grant') ||
                        error.message.includes('invalid_request') ||
                        error.message.includes('invalid_client') ||
                        error.message.includes('unauthorized')
                    )
                ) {
                    console.log('[TROUBLESHOOT] Common authentication issues:');
                    console.log('  - GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY must be set in your .env file');
                    console.log('    (or in the Render dashboard). Credentials are read from the environment,');
                    console.log('    not from a service account JSON file.');
                    console.log('  - CALENDAR_ID must be set in your .env file.');
                    console.log('  - Make sure your Google Service Account has adequate permissions to the specified Google Calendar.');
                }
                failureCount++;
            }
        }

        // Output summary
        logger.info(`Event creation completed. Successfully created: ${successCount}, Failed: ${failureCount}`);
        process.exit(0); // Ensure clean exit after successful completion
    } catch (error) {
        if (error && error.message) {
            logger.error('Error connecting to the calendar:', error.message);
            if (error.stack && !error.message.includes('ENOENT')) {
                logger.error(error.stack);
            }
        } else {
            logger.error('An unknown error occurred while connecting to the calendar:', error);
        }
        process.exit(1); // Exit with error code
    } finally {
        logger.info('connectToCalendar completed.');
    }
}

// Delete all upcoming events from the calendar
async function deleteUpcomingEvents(calendar) {
    // Parameter validation
    if (!calendar || typeof calendar !== 'object') {
        throw new Error('deleteUpcomingEvents: calendar must be a valid calendar client object');
    }
    
    try {
        const calendarId = process.env.CALENDAR_ID;
        // Use the same date cutoff as event creation logic for consistency
        const today = new Date().toISOString().split('T')[0] + 'T00:00:00.000Z';

        const eventsResponse = await calendar.events.list({
            calendarId,
            timeMin: today,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = eventsResponse.data.items || [];

        if (events.length) {
            logger.info(`Found ${events.length} upcoming events. Deleting them...`);
            let deleteCount = 0;
            for (const event of events) {
                try {
                    await calendar.events.delete({
                        calendarId,
                        eventId: event.id,
                    });
                    deleteCount++;
                    console.log(`[INFO] Deleted event (${deleteCount}/${events.length}): ${event.summary}`);
                } catch (error) {
                    logger.error(`Failed to delete event: ${event.summary}`, error.message);
                }
            }
        } else {
            logger.info('No upcoming events found to delete.');
        }
    } catch (error) {
        logger.error('Error deleting upcoming events:', error.message);
    }
}

connectToCalendar().catch(err => {
    logger.error('Unhandled exception:', err);
    logger.summary(0, 0, 1);
});
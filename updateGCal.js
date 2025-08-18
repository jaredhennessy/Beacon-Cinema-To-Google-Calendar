/**
 * updateGCal.js
 * Synchronizes The Beacon Cinema schedule (from files/schedule.csv) with a Google Calendar.
 * 
 * Usage: node updateGCal.js
 * 
 * Operations:
 * - Deletes all upcoming events from the specified Google Calendar
 * - Creates new events with runtime and series info if available
 * - Uses service account authentication (no OAuth2 or tokens needed)
 * - Ensures header rows in all CSVs
 * - Provides error handling and clear output messages
 * 
 * Required files:
 * - beacon-calendar-update.json (service account key)
 * - .env with CALENDAR_ID
 * - files/schedule.csv
 * 
 * Dependencies: googleapis, dotenv, csv-parser, ./gcalAuth.js, ./utils.js
 */

// External dependencies
const fs = require('fs');
const { google } = require('googleapis');
const dotenv = require('dotenv');
const csv = require('csv-parser');
const path = require('path');

// Internal dependencies
const { getServiceAccountClient } = require('./gcalAuth');
const { ensureHeader, deduplicateRows, checkFile } = require('./utils');
const logger = require('./logger')('updateGCal');
const { setupErrorHandling, handleError } = require('./errorHandler');

dotenv.config();

const TOKEN_PATH = 'token.json';
const SCHEDULE_CSV_PATH = path.join(__dirname, 'files', 'schedule.csv');
const TIME_ZONE = process.env.TIME_ZONE || 'America/Los_Angeles';

setupErrorHandling(logger, 'updateGCal.js');

/**
 * Formats a string to title case with proper capitalization
 * @param {string} str - String to format
 * @returns {string} Formatted string in title case
 */
function formatString(str) {
    // Parameter validation
    if (str === null || str === undefined) {
        return '';
    }
    if (typeof str !== 'string') {
        throw new Error('formatString: str must be a string');
    }
    
    return str
        .replace(/^"|"$/g, '')
        .split(' ')
        .map(word => {
            const firstCharIndex = [...word].findIndex(char => char.match(/[a-zA-Z]/));
            if (firstCharIndex === -1) return word;
            return (
                word.slice(0, firstCharIndex) +
                word.charAt(firstCharIndex).toUpperCase() +
                word.slice(firstCharIndex + 1).toLowerCase()
            );
        })
        .join(' ');
}

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

        const seriesIndexPath = path.join(__dirname, 'files', 'seriesIndex.csv');
        const runtimesCsvPath = path.join(__dirname, 'files', 'runtimes.csv');
        const seriesMap = new Map();

        // Check for required files
        checkFile(SCHEDULE_CSV_PATH, {
            required: true,
            missingMessage: 'schedule.csv is required but missing. Please run beaconSchedule.js first.',
            parentScript: 'updateGCal.js'
        });

        // Optional files - will be created if missing
        ensureHeader(runtimesCsvPath, 'Title,Runtime');
        ensureHeader(seriesIndexPath, 'seriesName,seriesURL,seriesTag');

        const runtimesMap = new Map();
        if (fs.existsSync(runtimesCsvPath)) {
            await new Promise((resolve, reject) => {
                fs.createReadStream(runtimesCsvPath)
                    .pipe(csv())
                    .on('data', row => {
                        if (row.Title && row.Runtime) {
                            runtimesMap.set(row.Title.trim(), row.Runtime.trim());
                        }
                    })
                    .on('end', resolve)
                    .on('error', reject);
            });
        }

        await new Promise((resolve, reject) => {
            fs.createReadStream(seriesIndexPath)
                .pipe(csv())
                .on('data', row => {
                    if (row.seriesTag && row.seriesName) {
                        seriesMap.set(row.seriesTag.trim(), row.seriesName.trim());
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        const eventsToCreate = [];
        const today = new Date().toISOString().split('T')[0];

        let allSkippedForMissingFields = true;
        let duplicateEventFound = false;
        const eventKeys = new Set();
        await new Promise((resolve, reject) => {
            fs.createReadStream(SCHEDULE_CSV_PATH)
                .pipe(csv())
                .on('data', row => {
                    if (!row || typeof row !== 'object') {
                        logger.warn('Skipping malformed row in schedule.csv:', row);
                        return;
                    }
                    if (!row.Date || !row.Time || !row.Title) {
                        logger.warn(`Skipping invalid row in schedule.csv: ${JSON.stringify(row)}`);
                        return;
                    }
                    allSkippedForMissingFields = false;
                    if (row.Date < today) {
                        logger.info(`Skipping past event: ${row.Title} on ${row.Date}`);
                        return;
                    }
                    const timeRegex = /^\d{2}:\d{2}$/;
                    if (!timeRegex.test(row.Time)) {
                        logger.error(`Invalid time format for event "${row.Title}": ${row.Time}`);
                        return;
                    }
                    const formattedTitle = formatString(row.Title);
                    const formattedSeriesName = row.SeriesTag && seriesMap.has(row.SeriesTag)
                        ? formatString(seriesMap.get(row.SeriesTag))
                        : '';

                    const descriptionParts = [];
                    const runtimeValue = runtimesMap.get(row.Title) || runtimesMap.get(row.Title.trim());
                    if (runtimeValue) descriptionParts.push(`Runtime: ${runtimeValue}`);
                    if (formattedSeriesName) descriptionParts.push(`Film Series: ${formattedSeriesName}`);
                    if (row.URL) descriptionParts.push(`URL: ${row.URL}`);
                    const description = descriptionParts.join('\n');

                    const startDateTime = new Date(`${row.Date}T${row.Time}`);
                    let endDateTime;
                    const runtimeMatch = runtimeValue && runtimeValue.match(/^(\d+)\s*minutes$/i);
                    if (runtimeMatch) {
                        const runtimeMinutes = parseInt(runtimeMatch[1], 10) + 15;
                        endDateTime = new Date(startDateTime.getTime() + runtimeMinutes * 60000);
                    } else {
                        endDateTime = new Date(startDateTime.getTime() + 2 * 60 * 60000);
                    }

                    const key = `${row.Title}|${row.Date}|${row.Time}`;
                    if (eventKeys.has(key)) duplicateEventFound = true;
                    eventKeys.add(key);

                    eventsToCreate.push({
                        summary: formattedTitle,
                        start: {
                            dateTime: startDateTime.toISOString(),
                            timeZone: TIME_ZONE,
                        },
                        end: {
                            dateTime: endDateTime.toISOString(),
                            timeZone: TIME_ZONE,
                        },
                        location: "The Beacon Cinema, 4405 Rainier Ave S, Seattle, WA 98118, USA",
                        description,
                    });
                })
                .on('end', resolve)
                .on('error', reject);
        });

        if (duplicateEventFound) {
            logger.warn('Duplicate events (by Title/Date/Time) found in schedule.csv.');
        }
        if (allSkippedForMissingFields) {
            logger.warn('All events were skipped due to missing required fields.');
        }

        if (eventsToCreate.length === 0) {
            logger.warn('No events to create after parsing schedule.csv. Exiting.');
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
                    console.log('  - Ensure beacon-calendar-update.json is present and valid (download from Google Cloud Console).');
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
        const today = new Date().toISOString();

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
/**
 * updateGCal.js
 * Synchronizes The Beacon Cinema schedule (from files/schedule.csv) with a Google Calendar.
 * Usage: node updateGCal.js
 * - Deletes all upcoming events from the specified Google Calendar.
 * - Creates new events based on the schedule, including runtime and series info if available.
 * - Handles Google OAuth2 authorization, storing tokens in token.json.
 * - Ensures header rows in all CSVs.
 * - Consistent error handling and output messaging.
 * Dependencies: googleapis, dotenv, csv-parser, ./gcalAuth.js, ./utils.js
 */

const fs = require('fs');
const { google } = require('googleapis');
const dotenv = require('dotenv');
const csv = require('csv-parser');
const path = require('path');
const { getAccessToken } = require('./gcalAuth');
const { ensureHeader, deduplicateRows } = require('./utils');

dotenv.config();

const TOKEN_PATH = 'token.json';
const SCHEDULE_CSV_PATH = path.join(__dirname, 'files', 'schedule.csv');
const TIME_ZONE = process.env.TIME_ZONE || 'America/Los_Angeles';

process.on('unhandledRejection', (reason) => {
    console.error('[ERROR] Unhandled promise rejection in updateGCal.js:', reason);
    console.log('[SUMMARY] Event creation completed. Successfully created: 0, Failed: 0');
    process.exit(1);
});

function formatString(str) {
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

if (!process.env.OAUTH2_REDIRECT_URI || !process.env.CALENDAR_ID) {
    console.error('[ERROR] OAUTH2_REDIRECT_URI and CALENDAR_ID must be set in your .env file.');
    process.exit(1);
}

async function connectToCalendar() {
    console.log('[START] updateGCal.js');
    try {
        if (!fs.existsSync('credentials.json')) {
            console.error('[ERROR] credentials.json file is missing.');
            process.exit(1);
        }

        const credentials = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
        const { client_secret, client_id } = credentials.web;

        const oAuth2Client = new google.auth.OAuth2(
            client_id,
            client_secret,
            process.env.OAUTH2_REDIRECT_URI
        );

        if (fs.existsSync(TOKEN_PATH)) {
            try {
                const token = fs.readFileSync(TOKEN_PATH, 'utf8');
                oAuth2Client.setCredentials(JSON.parse(token));
            } catch (e) {
                console.error('[ERROR] token.json is malformed. Please delete and reauthorize.');
                console.log('[SUMMARY] Event creation completed. Successfully created: 0, Failed: 0');
                process.exit(1);
            }
        } else {
            console.log('[INFO] No token found. Starting authorization flow...');
            await getAccessToken(oAuth2Client); // Wait for authorization to complete
        }

        if (!oAuth2Client.credentials || !oAuth2Client.credentials.access_token) {
            console.error('[ERROR] OAuth2 client is not authenticated. Exiting...');
            console.log('[TROUBLESHOOT] Your token may be expired or missing. Try deleting token.json and re-running the script.');
            process.exit(1); // Ensure this exit happens only if authentication fails
        }

        const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

        const seriesIndexPath = path.join(__dirname, 'files', 'seriesIndex.csv');
        const runtimesCsvPath = path.join(__dirname, 'files', 'runtimes.csv');
        const seriesMap = new Map();

        if (!fs.existsSync(SCHEDULE_CSV_PATH)) {
            console.error(`[ERROR] ${SCHEDULE_CSV_PATH} does not exist. Please run beaconSchedule.js first.`);
            console.log('[SUMMARY] Event creation completed. Successfully created: 0, Failed: 0');
            return;
        }

        // Ensure header for all CSVs before reading/writing
        ensureHeader(SCHEDULE_CSV_PATH, 'Title,Date,Time,URL,SeriesTag,DateRecorded');
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
                        console.warn('[WARN] Skipping malformed row in schedule.csv:', row);
                        return;
                    }
                    if (!row.Date || !row.Time || !row.Title) {
                        console.warn(`[WARN] Skipping invalid row in schedule.csv: ${JSON.stringify(row)}`);
                        return;
                    }
                    allSkippedForMissingFields = false;
                    if (row.Date < today) {
                        console.log(`[INFO] Skipping past event: ${row.Title} on ${row.Date}`);
                        return;
                    }
                    const timeRegex = /^\d{2}:\d{2}$/;
                    if (!timeRegex.test(row.Time)) {
                        console.error(`[ERROR] Invalid time format for event "${row.Title}": ${row.Time}`);
                        return;
                    }
                    const formattedTitle = formatString(row.Title);
                    const formattedSeriesName = row.SeriesTag && seriesMap.has(row.SeriesTag)
                        ? formatString(seriesMap.get(row.SeriesTag))
                        : '';

                    const descriptionParts = [];
                    let runtimeValue = runtimesMap.get(row.Title) || runtimesMap.get(row.Title.trim());
                    if (runtimeValue) descriptionParts.push(`Runtime: ${runtimeValue}`);
                    if (formattedSeriesName) descriptionParts.push(`Film Series: ${formattedSeriesName}`);
                    if (row.URL) descriptionParts.push(`URL: ${row.URL}`);
                    const description = descriptionParts.join('\n');

                    let startDateTime = new Date(`${row.Date}T${row.Time}`);
                    let endDateTime;
                    let runtimeMatch = runtimeValue && runtimeValue.match(/^(\d+)\s*minutes$/i);
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
            console.warn('[WARN] Duplicate events (by Title/Date/Time) found in schedule.csv.');
        }
        if (allSkippedForMissingFields) {
            console.warn('[WARN] All events were skipped due to missing required fields.');
        }

        if (eventsToCreate.length === 0) {
            console.warn('[WARN] No events to create after parsing schedule.csv. Exiting.');
            console.log('[SUMMARY] Event creation completed. Successfully created: 0, Failed: 0');
            return;
        }

        // Deduplicate events by summary/start time
        const uniqueEventsToCreate = deduplicateRows(eventsToCreate, event => `${event.summary}|${event.start.dateTime}`);
        let duplicateWritten = uniqueEventsToCreate.length < eventsToCreate.length;

        if (duplicateWritten) {
            console.warn('[WARN] Duplicate events found in final uniqueEventsToCreate.');
        }
        if (uniqueEventsToCreate.length === 0) {
            console.error('[ERROR] No valid events to create. Exiting without deleting existing events.');
            console.log('[SUMMARY] Event creation completed. Successfully created: 0, Failed: 0');
            console.warn('[SUMMARY] No valid events were written to Google Calendar.');
            return;
        }

        console.log(`[INFO] Creating ${uniqueEventsToCreate.length} events.`);
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
                console.error(`[ERROR] Failed to create event: ${event.summary}`, error.message);
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
                    console.log('  - Ensure credentials.json is present and valid (download from Google Cloud Console).');
                    console.log('  - OAUTH2_REDIRECT_URI and CALENDAR_ID must be set in your .env file.');
                    console.log('  - If you see "redirect_uri_mismatch", update your Google Cloud Console OAuth2 redirect URI.');
                    console.log('  - If you see "invalid_grant", the authorization code may have expired. Try authorizing again.');
                    console.log('  - If you see "invalid_request", check your credentials.json and .env for typos.');
                    console.log('  - Make sure your Google Cloud project has the Calendar API enabled.');
                    console.log('  - Delete token.json and re-run the script to reauthorize if token issues persist.');
                }
                failureCount++;
            }
        }

        // Output summary
        console.log(`[SUMMARY] Event creation completed. Successfully created: ${successCount}, Failed: ${failureCount}`);
        process.exit(0); // Ensure clean exit after successful completion
    } catch (error) {
        if (error && error.message) {
            console.error('[ERROR] Error connecting to the calendar:', error.message);
            if (error.stack && !error.message.includes('ENOENT')) {
                console.error(error.stack);
            }
        } else {
            console.error('[ERROR] An unknown error occurred while connecting to the calendar:', error);
        }
        console.log('[SUMMARY] Event creation completed. Successfully created: 0, Failed: 0');
        process.exit(1); // Exit with error code
    } finally {
        console.log('[INFO] connectToCalendar completed.');
    }
}

// Delete all upcoming events from the calendar
async function deleteUpcomingEvents(calendar) {
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
            console.log(`[INFO] Found ${events.length} upcoming events. Deleting them...`);
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
                    console.error(`[ERROR] Failed to delete event: ${event.summary}`, error.message);
                }
            }
        } else {
            console.info('[INFO] No upcoming events found to delete.');
            console.log('[SUMMARY] No upcoming events to delete.');
        }
    } catch (error) {
        console.error('[ERROR] Error deleting upcoming events:', error.message);
    }
}

connectToCalendar().catch(err => {
    console.error('[ERROR] Unhandled exception in updateGCal.js:', err);
    console.log('[SUMMARY] Event creation completed. Successfully created: 0, Failed: 0');
});
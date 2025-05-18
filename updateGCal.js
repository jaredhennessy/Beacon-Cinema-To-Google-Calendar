const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const dotenv = require('dotenv');
const http = require('http');
const url = require('url');
const csv = require('csv-parser');
const path = require('path');

// Load environment variables from .env
dotenv.config();

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_PATH = 'token.json';
const SCHEDULE_CSV_PATH = path.join(__dirname, 'files', 'schedule.csv');
const TIME_ZONE = process.env.TIME_ZONE || 'America/Los_Angeles';

/**
 * Formats a string by capitalizing the first letter of each word,
 * skipping quotation marks and special characters, and removing any
 * quotation marks at the beginning or end of the string.
 * @param {string} str - The string to format.
 * @returns {string} - The formatted string.
 */
function formatString(str) {
    return str
        .replace(/^"|"$/g, '') // Remove quotation marks at the beginning or end
        .split(' ')
        .map(word => {
            const firstCharIndex = [...word].findIndex(char => char.match(/[a-zA-Z]/));
            if (firstCharIndex === -1) return word; // No alphabetic character found
            return (
                word.slice(0, firstCharIndex) + // Preserve leading non-alphabetic characters
                word.charAt(firstCharIndex).toUpperCase() + // Capitalize the first alphabetic character
                word.slice(firstCharIndex + 1).toLowerCase() // Lowercase the rest of the word
            );
        })
        .join(' ');
}

async function connectToCalendar() {
    try {
        if (!fs.existsSync('credentials.json')) {
            console.error('Error: credentials.json file is missing.');
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
            const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
            oAuth2Client.setCredentials(token);
        } else {
            console.log('No token found. Starting authorization flow...');
            await getAccessToken(oAuth2Client);
        }

        if (!oAuth2Client.credentials || !oAuth2Client.credentials.access_token) {
            console.error('Error: OAuth2 client is not authenticated. Exiting...');
            process.exit(1);
        }

        const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

        const seriesIndexPath = path.join(__dirname, 'files', 'seriesIndex.csv');
        const seriesMap = new Map();

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

        await new Promise((resolve, reject) => {
            fs.createReadStream(SCHEDULE_CSV_PATH)
                .pipe(csv())
                .on('data', row => {
                    if (!row.Date || !row.Time || !row.Title) {
                        console.error(`Skipping invalid row: ${JSON.stringify(row)}`);
                        return;
                    }

                    if (row.Date < today) {
                        console.log(`Skipping past event: ${row.Title} on ${row.Date}`);
                        return;
                    }

                    const timeRegex = /^\d{2}:\d{2}$/;
                    if (!timeRegex.test(row.Time)) {
                        console.error(`Invalid time format for event "${row.Title}": ${row.Time}`);
                        return;
                    }

                    const { time: endTime, nextDay } = addDuration(row.Time, 2);
                    const endDate = nextDay
                        ? new Date(new Date(row.Date).getTime() + 24 * 60 * 60 * 1000)
                              .toISOString()
                              .split('T')[0]
                        : row.Date;

                    const formattedTitle = formatString(row.Title);
                    const formattedSeriesName = row.SeriesTag && seriesMap.has(row.SeriesTag)
                        ? formatString(seriesMap.get(row.SeriesTag))
                        : '';

                    const descriptionParts = [];
                    if (formattedSeriesName) {
                        descriptionParts.push(`Film Series: ${formattedSeriesName}`);
                    }
                    if (row.URL) {
                        descriptionParts.push(`URL: ${row.URL}`);
                    }
                    const description = descriptionParts.join('\n');

                    eventsToCreate.push({
                        summary: formattedTitle,
                        start: {
                            dateTime: new Date(`${row.Date}T${row.Time}`).toISOString(),
                            timeZone: TIME_ZONE,
                        },
                        end: {
                            dateTime: new Date(`${endDate}T${endTime}`).toISOString(),
                            timeZone: TIME_ZONE,
                        },
                        location: "The Beacon Cinema, 4405 Rainier Ave S, Seattle, WA 98118, USA",
                        description,
                    });
                })
                .on('end', resolve)
                .on('error', reject);
        });

        if (eventsToCreate.length === 0) {
            console.error('No valid events to create. Exiting without deleting existing events.');
            return;
        }

        console.log(`Creating ${eventsToCreate.length} events.`);
        await deleteUpcomingEvents(calendar);

        let successCount = 0;
        let failureCount = 0;

        for (const event of eventsToCreate) {
            try {
                await calendar.events.insert({
                    calendarId: process.env.CALENDAR_ID,
                    resource: event,
                });
                console.log(`Event created: ${event.summary}`);
                successCount++;
            } catch (error) {
                console.error(`Failed to create event: ${event.summary}`, error.message);
                failureCount++;
            }
        }

        console.log(`Event creation completed. Successfully created: ${successCount}, Failed: ${failureCount}`);
    } catch (error) {
        console.error('Error connecting to the calendar:', error.message);
    }
}

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

        const events = eventsResponse.data.items;

        if (events.length) {
            console.log(`Found ${events.length} upcoming events. Deleting them...`);
            for (const event of events) {
                try {
                    await calendar.events.delete({
                        calendarId,
                        eventId: event.id,
                    });
                    console.log(`Deleted event: ${event.summary}`);
                } catch (error) {
                    console.error(`Failed to delete event: ${event.summary}`, error.message);
                }
            }
        } else {
            console.log('No upcoming events to delete.');
        }
    } catch (error) {
        console.error('Error deleting upcoming events:', error.message);
    }
}

async function getAccessToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this URL:', authUrl);

    return new Promise((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            if (req.url.startsWith('/')) {
                const query = new url.URL(req.url, 'http://localhost:3000').searchParams;
                const code = query.get('code');

                if (code) {
                    res.end('Authorization successful! You can close this window.');
                    try {
                        const { tokens } = await oAuth2Client.getToken(code);
                        oAuth2Client.setCredentials(tokens);
                        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                        console.log('Token stored to', TOKEN_PATH);
                        console.log('Please re-run the script now that the token has been created.');
                        server.close(() => resolve());
                    } catch (err) {
                        console.error('Error retrieving access token:', err.message);
                        res.end('Error retrieving access token. Check the console for details.');
                        server.close(() => reject(err));
                    }
                } else {
                    res.end('Authorization failed. No code received.');
                    server.close(() => reject(new Error('No authorization code received.')));
                }
            }
        });

        server.listen(3000, () => {
            console.log('Waiting for authorization on http://localhost:3000...');
        });

        process.on('SIGINT', () => {
            console.log('Shutting down the server...');
            server.close(() => {
                console.log('Server closed.');
                process.exit(0);
            });
        });
    });
}

function addDuration(time, durationHours) {
    const timeRegex = /^\d{2}:\d{2}$/;
    if (!timeRegex.test(time)) {
        throw new Error(`Invalid time format: ${time}`);
    }

    const [hours, minutes] = time.split(':').map(Number);
    const endHours = (hours + durationHours) % 24;
    const nextDay = hours + durationHours >= 24;

    return {
        time: `${endHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
        nextDay,
    };
}

connectToCalendar();
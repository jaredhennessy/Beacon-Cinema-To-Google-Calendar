const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');
const dotenv = require('dotenv');
const http = require('http');
const url = require('url');
const csv = require('csv-parser');

// Load environment variables from .env
dotenv.config();

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_PATH = 'token.json';
const SCHEDULE_CSV_PATH = 'schedule.csv';
const TIME_ZONE = process.env.TIME_ZONE || 'America/Los_Angeles'; // Default to America/Los_Angeles

async function connectToCalendar() {
    try {
        // Load client secrets from credentials.json
        if (!fs.existsSync('credentials.json')) {
            console.error('Error: credentials.json file is missing.');
            process.exit(1);
        }

        let credentials;
        try {
            credentials = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
        } catch (error) {
            console.error('Error: Failed to parse credentials.json.', error.message);
            process.exit(1);
        }

        const { client_secret, client_id } = credentials.web;

        // Create an OAuth2 client
        const oAuth2Client = new google.auth.OAuth2(
            client_id,
            client_secret,
            process.env.OAUTH2_REDIRECT_URI // Use redirect URI from .env
        );

        // Check if we have previously stored a token
        if (fs.existsSync(TOKEN_PATH)) {
            const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
            oAuth2Client.setCredentials(token);
        } else {
            await getAccessToken(oAuth2Client);
        }

        // Initialize the Calendar API
        const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

        // Delete all upcoming events
        await deleteUpcomingEvents(calendar);

        // Read the first five records from schedule.csv and create events
        const eventsToCreate = [];
        await new Promise((resolve, reject) => {
            fs.createReadStream(SCHEDULE_CSV_PATH)
                .pipe(csv())
                .on('data', (row) => {
                    if (!row.Date || !row.Time || !row.Title) {
                        console.error(`Skipping invalid row: ${JSON.stringify(row)}`);
                        return;
                    }

                    // Validate the Time field
                    const timeRegex = /^\d{2}:\d{2}$/; // Matches HH:MM format
                    if (!timeRegex.test(row.Time)) {
                        console.error(`Invalid time format for event "${row.Title}": ${row.Time}`);
                        return; // Skip this row
                    }

                    // Calculate the end time and check if it rolls over to the next day
                    const { time: endTime, nextDay } = addDuration(row.Time, 2); // Default duration: 2 hours
                    const endDate = nextDay
                        ? new Date(new Date(row.Date).getTime() + 24 * 60 * 60 * 1000) // Add one day
                              .toISOString()
                              .split('T')[0] // Extract the date in YYYY-MM-DD format
                        : row.Date;

                    // Log the record and calculated values for troubleshooting
                    console.log(`Processing record:`, row);
                    console.log(`Calculated endDate: ${endDate}, endTime: ${endTime}`);

                    try {
                        eventsToCreate.push({
                            summary: row.Title,
                            start: {
                                dateTime: new Date(`${row.Date}T${row.Time}`).toISOString(),
                                timeZone: TIME_ZONE,
                            },
                            end: {
                                dateTime: new Date(`${endDate}T${endTime}`).toISOString(),
                                timeZone: TIME_ZONE,
                            },
                            description: `Lynchian: ${row.Lynchian}\nURL: ${row.URL}`,
                        });
                    } catch (error) {
                        console.error(`Error processing record:`, row);
                        console.error(`Error details:`, error.message);
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        console.log('Creating events from schedule.csv...');
        for (const event of eventsToCreate) {
            try {
                await calendar.events.insert({
                    calendarId: process.env.CALENDAR_ID,
                    resource: event,
                });
                console.log(`Event created: ${event.summary}`);
            } catch (error) {
                console.error(`Failed to create event: ${event.summary}`, error.message);
            }
        }

        // Fetch and display the next 10 events
        await listUpcomingEvents(calendar);
    } catch (error) {
        console.error('Error connecting to the calendar:', error.message);
    }
}

async function deleteUpcomingEvents(calendar) {
    try {
        const calendarId = process.env.CALENDAR_ID;

        // Fetch all upcoming events
        const eventsResponse = await calendar.events.list({
            calendarId,
            timeMin: new Date().toISOString(),
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

async function listUpcomingEvents(calendar) {
    try {
        const calendarId = process.env.CALENDAR_ID;
        const eventsResponse = await calendar.events.list({
            calendarId,
            timeMin: new Date().toISOString(),
            maxResults: 10,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = eventsResponse.data.items;
        if (events.length) {
            console.log('Upcoming 10 events:');
            events.forEach((event, i) => {
                const start = event.start.dateTime || event.start.date; // Use dateTime or fallback to date
                console.log(`${i + 1}. ${event.summary} (${start})`);
            });
        } else {
            console.log('No upcoming events found.');
        }
    } catch (error) {
        console.error('Error fetching upcoming events:', error.message);
    }
}

async function getAccessToken(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this URL:', authUrl);

    const server = http.createServer(async (req, res) => {
        if (req.url.startsWith('/')) {
            const query = new url.URL(req.url, 'http://localhost:3000').searchParams;
            const code = query.get('code');

            if (code) {
                res.end('Authorization successful! You can close this window.');
                server.close();

                try {
                    const { tokens } = await oAuth2Client.getToken(code);
                    oAuth2Client.setCredentials(tokens);

                    // Store the token to disk for later program executions
                    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                    console.log('Token stored to', TOKEN_PATH);
                } catch (err) {
                    console.error('Error retrieving access token', err);
                }
            } else {
                res.end('Authorization failed. No code received.');
            }
        }
    }).listen(3000, () => {
        console.log('Waiting for authorization...');
    });
}

function addDuration(time, durationHours) {
    const timeRegex = /^\d{2}:\d{2}$/; // Matches HH:MM format
    if (!timeRegex.test(time)) {
        throw new Error(`Invalid time format: ${time}`);
    }

    const [hours, minutes] = time.split(':').map(Number);
    const endHours = (hours + durationHours) % 24;
    const nextDay = hours + durationHours >= 24; // Check if the time rolls over to the next day

    return {
        time: `${endHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
        nextDay,
    };
}

connectToCalendar();
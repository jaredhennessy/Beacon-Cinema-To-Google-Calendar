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
const SCHEDULE_CSV_PATH = 'files/schedule.csv';
const TIME_ZONE = process.env.TIME_ZONE || 'America/Los_Angeles'; // Default to America/Los_Angeles

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

        // Load seriesIndex.csv into a map for quick lookup
        const seriesIndexPath = 'files/seriesIndex.csv';
        const seriesMap = new Map();

        await new Promise((resolve, reject) => {
            fs.createReadStream(seriesIndexPath)
                .pipe(csv())
                .on('data', (row) => {
                    if (row.seriesTag && row.seriesName) {
                        seriesMap.set(row.seriesTag.trim(), row.seriesName.trim());
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        // Read schedule.csv and create events
        const eventsToCreate = [];
        const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
        await new Promise((resolve, reject) => {
            fs.createReadStream(SCHEDULE_CSV_PATH)
                .pipe(csv())
                .on('data', (row) => {
                    if (!row.Date || !row.Time || !row.Title) {
                        console.error(`Skipping invalid row: ${JSON.stringify(row)}`);
                        return;
                    }

                    // Skip events with a start date earlier than today
                    if (row.Date < today) {
                        console.log(`Skipping past event: ${row.Title} on ${row.Date}`);
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

                    let formattedTitle = '';
                    formattedTitle = formatString(row.Title); // Apply formatString to Title
                    
                    // Look up seriesName using seriesTag and reformat it
                    let formattedSeriesName = '';
                    if (row.SeriesTag && seriesMap.has(row.SeriesTag)) {
                        formattedSeriesName = formatString(seriesMap.get(row.SeriesTag)); // Apply formatString to seriesName
                    }

                    // Log the record and calculated values for troubleshooting
                    console.log(`Processing record:`, {
                        ...row,
                        formattedTitle,
                        formattedSeriesName,
                    });
                    console.log(`Calculated endDate: ${endDate}, endTime: ${endTime}`);

                    try {
                        
                        // Build the description dynamically
                        const descriptionParts = [];
                        if (formattedSeriesName) {
                            descriptionParts.push(`Film Series: ${formattedSeriesName}`);
                        }
                        if (row.URL) {
                            descriptionParts.push(`URL: ${row.URL}`);
                        }
                        const description = descriptionParts.join('\n'); // Combine parts with a newline

                        eventsToCreate.push({
                            summary: formattedTitle, // Use formatted title
                            start: {
                                dateTime: new Date(`${row.Date}T${row.Time}`).toISOString(),
                                timeZone: TIME_ZONE,
                            },
                            end: {
                                dateTime: new Date(`${endDate}T${endTime}`).toISOString(),
                                timeZone: TIME_ZONE,
                            },
                            location: "The Beacon Cinema, 4405 Rainier Ave S, Seattle, WA 98118, USA", // Set location
                            description, // Use dynamically built description
                        });
                    } catch (error) {
                        console.error(`Error processing record:`, row);
                        console.error(`Error details:`, error.message);
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        // Verify eventsToCreate contains at least one legitimate record
        if (eventsToCreate.length === 0) {
            console.error('No valid events to create. Exiting without deleting existing events.');
            return;
        }

        // Prompt the user for the number of events to create
        const limitedEventsToCreate = await new Promise((resolve) => {
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
            });

            const timeout = setTimeout(() => {
                console.log('No input received. Creating all events.');
                rl.close();
                resolve(eventsToCreate); // No limit
            }, 5000); // 5-second timeout

            rl.question('Enter the number of events to create (or press Enter for all): ', (answer) => {
                clearTimeout(timeout);
                rl.close();
                const limit = parseInt(answer, 10);
                if (!isNaN(limit) && limit > 0) {
                    resolve(eventsToCreate.slice(0, limit)); // Limit the number of events
                } else {
                    console.log('Invalid input or no input provided. Creating all events.');
                    resolve(eventsToCreate); // No limit
                }
            });
        });

        console.log(`Creating ${limitedEventsToCreate.length} events.`);

        // Delete all upcoming events
        await deleteUpcomingEvents(calendar);

        console.log('Creating events from schedule.csv...');
        for (const event of limitedEventsToCreate) {
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
        
        console.log('All events created successfully!');

    } catch (error) {
        console.error('Error connecting to the calendar:', error.message);
    }
}

async function deleteUpcomingEvents(calendar) {
    try {
        const calendarId = process.env.CALENDAR_ID;
        const today = new Date().toISOString(); // Get today's date and time in ISO format

        // Fetch all upcoming events
        const eventsResponse = await calendar.events.list({
            calendarId,
            timeMin: today, // Only fetch events starting from today
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
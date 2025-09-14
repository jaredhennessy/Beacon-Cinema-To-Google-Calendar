# Beacon Cinema Calendar Sync

Automates scraping [The Beacon Cinema](https://thebeacon.film/calendar) schedule and syncing it to Google Calendar, including runtime and film series details, using Google Sheets for data management.

## Summary

This project scrapes film series and schedule data from The Beacon Cinema, stores it in Google Sheets (`series`, `schedule`, `runtimes`), and syncs events to Google Calendar. It supports both CLI and web interface usage, and is optimized for deployment on Render.com.

## Features

- Film series management
- Schedule extraction
- Runtime discovery
- Google Calendar integration
- Google Sheets integration (`series`, `schedule`, `runtimes`)
- Automated execution (CLI and web interface)
- Render.com ready (optimized Puppeteer config)
- Minimal logging and comprehensive error handling
- Data deduplication and parameter validation

## Quick Start

```bash
npm install
# Copy and edit your .env file with credentials
npm start              # Launch web interface
# Or run the full pipeline:
node fullUpdate.js
```

## Environment Variables

Add these to your `.env` file:

```bash
GOOGLE_TYPE=service_account
GOOGLE_PROJECT_ID=your-project-id
GOOGLE_PRIVATE_KEY_ID=your-key-id
GOOGLE_PRIVATE_KEY="your-private-key"
GOOGLE_CLIENT_EMAIL=your-service-account-email
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
GOOGLE_TOKEN_URI=https://oauth2.googleapis.com/token
GOOGLE_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
GOOGLE_CLIENT_X509_CERT_URL=your-cert-url
SPREADSHEET_ID=your-google-sheet-id
CALENDAR_ID=your-calendar-id
TIME_ZONE=America/Los_Angeles
```

## Google Sheets Setup

## Script Overview

| Script              | Purpose                                      |
|---------------------|----------------------------------------------|
| beaconSeries.js     | Scrape series info, update `series` tab      |
| beaconSchedule.js   | Scrape schedule, update `schedule` tab       |
| findRuntimes.js     | Find runtimes, update `runtimes` tab         |
| updateGCal.js       | Sync schedule to Google Calendar             |
| fullUpdate.js       | Run all steps above in sequence              |
| clearLogs.js        | Empty all log files                          |
| testPuppeteer.js    | Verify Puppeteer/Chrome setup                |

## Usage

### CLI

```bash
node fullUpdate.js
# Or run scripts individually:
node beaconSeries.js
node beaconSchedule.js
node findRuntimes.js
node updateGCal.js
```

### Web Interface

```bash
npm start
# Open http://localhost:3000 in your browser
```

## Deployment (Render.com)

- See `render.yaml` and `PUPPETEER_RENDER_SETUP.md`
- Set environment variables in Render.com dashboard

## Logging & Maintenance

- Logs in `logs/` directory
- Log management via CLI and web interface

### Log Management Features

**Automatic Log Rotation**:

- Log files are automatically rotated when they exceed 10MB (configurable)
- Keeps up to 5 rotated files per script (configurable)
- Old files are automatically deleted after 30 days (configurable)

**Manual Log Management**:

```bash
# View log statistics
npm run log-stats

# Rotate large log files
npm run log-rotate

# Clean up old log files  
npm run log-cleanup

# Full maintenance (rotate + cleanup + compress)
npm run log-maintain
```

**Web Interface**: Log management is available in the web interface with dedicated buttons for statistics, rotation, cleanup, and maintenance.

**Configuration**: Set environment variables to customize log behavior:

- `MAX_LOG_SIZE_MB=10` - Size limit before rotation
- `MAX_LOG_FILES=5` - Number of rotated files to keep
- `LOG_RETENTION_DAYS=30` - Days to keep old log files
- `COMPRESS_LOGS=true` - Enable compression of rotated logs (Linux only)

### Logger Script Usage

```javascript
const logger = require('./logger')('scriptName');
// ...existing code...
```

### Log File Location and Format

### Google Sheets Issues

- **Missing Tabs**: Ensure the Google Sheet has the required tabs (`seriesIndex`, `series`, `schedule`, `runtimes`).
- **Permission Errors**: Verify that the service account email has been added as an editor to the Google Sheet.
- **Invalid Sheet ID**: Check that the `SHEET_ID` in your `.env` file matches the ID of your Google Sheet.

### Google Authentication Issues

- **Calendar Permissions**: The service account email must be added as an editor to your Google Calendar.
- **API Access**: Confirm the Google Calendar API and Sheets API are enabled for your Google Cloud project.

Log files are written to the `logs/` directory with one file per script:

- `beaconSeries.log`
- `beaconSchedule.log`
- `findRuntimes.log`
- `updateGCal.log`
- `utils.log`
- `fullUpdate.log`

Each script run starts with a session marker and entries have a consistent format:

```log
================================================================================
2025-08-18T21:58:38.424Z Session Start: beaconSeries
================================================================================
[2025-08-18T21:58:40.726Z] [INFO] Starting beaconSeries.js
[2025-08-18T21:58:40.739Z] [INFO] Found 14 series in Google Sheets.
[2025-08-18T21:58:41.191Z] [ERROR] Error scraping series: Connection failed
Stack Trace:
Error: Connection failed
  at scrapeFilms (d:\code\jcal\beaconSeries.js:42:15)
```

### Logging System Features

- **Timestamping**: All entries include ISO 8601 timestamps
- **Session Markers**: Each script run is clearly delimited in the log file  
- **Console Mirroring**: All logs are output to console with appropriate coloring
- **Error Tracing**: Error logs automatically include stack traces when available
- **Summary Statistics**: Scripts track and report processed/skipped/error counts
- **Auto-Configuration**: Creates `logs/` directory if missing
- **Parameter Validation**: All log methods validate input parameters

## Google Sheets Integration

- All scripts interact with a shared Google Sheet for data storage and retrieval.
- The sheet must have the following tabs:
  - `Series`: Stores film series definitions.
  - `Schedule`: Stores the current schedule of films (title, date, time, URL, series tag).
  - `Runtimes`: Stores runtime information for each film.

> **Note:** Ensure the Google Sheet is shared with the service account email.

## Script Outputs

- `Series` tab: List of film titles and their associated series tags, updated by `beaconSeries.js`.
- `Schedule` tab: The current schedule of films (title, date, time, URL, series tag), updated by `beaconSchedule.js`.
- `Runtimes` tab: Runtime information for each film, updated by `findRuntimes.js`.

## Updating or Resetting Data

- To reset runtimes, run `findRuntimes.js` and choose to replace the `Runtimes` tab when prompted.
- To reset series data, edit or replace the `Series` tab and rerun `beaconSeries.js`.
- To clear all Google Calendar events and resync, run `updateGCal.js` or the full pipeline.

## Installation

1. Clone the repository:

    ```bash
    git clone <repository_url>
    cd jcal
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

## Configuration

1. **Google Cloud Project Setup**:
    - Go to Google Cloud Console.
    - Enable the Calendar API and Sheets API.
    - Create a service account and download the JSON key as `beacon-calendar-update.json` to your project root.
    - In the Google Calendar web UI, share your target calendar with the service account email (as an editor).
    - Share your Google Sheet with the service account email (as an editor).

2. **Environment Configuration**:
    - Create a `.env` file in the project root with the following variables:

        ```env
        # Required: The ID of your target Google Calendar
        # Get this from the calendar's settings in Google Calendar
        # Format: either the email-style ID or the long alphanumeric ID
        CALENDAR_ID=your_calendar_id@group.calendar.google.com

        # Optional: The timezone for calendar events
        # Default: America/Los_Angeles if not specified
        # Format: IANA timezone name (e.g., Europe/London, Asia/Tokyo)
        TIME_ZONE=America/Los_Angeles

        # Required: The ID of your Google Sheet
        # Get this from the URL of the sheet (e.g., the part after /d/ and before /edit)
        SHEET_ID=your_google_sheet_id
        ```

        > **Important**: The `CALENDAR_ID` must be the calendar where your service account has been added as an editor.

## Running the Scripts

### Full Pipeline (Recommended)

Run the complete update process using either:

```bash
npm start
```

or:

```bash
node fullUpdate.js
```

This script automatically executes the complete pipeline without user prompts, making it perfect for web deployments and automated execution:

1. `beaconSeries.js` - Updates film series data from the `Series` tab in Google Sheets.
2. `beaconSchedule.js` - Scrapes the current schedule and writes to the `Schedule` tab in Google Sheets.
3. `findRuntimes.js` - Extracts runtime information for scheduled films and writes to the `Runtimes` tab in Google Sheets.
4. `updateGCal.js` - Updates Google Calendar with the latest schedule.

### Individual Scripts

You can also run each script individually as needed:

```bash
node beaconSeries.js
```

- Scrapes film titles from each series page listed in the `Series` tab.
- Updates the `Series` tab in Google Sheets.
- Removes outdated entries for each SeriesTag before adding new ones.
- Deduplicates titles and warns about duplicates.

#### Schedule Update

```bash
node beaconSchedule.js
```

- Scrapes the current calendar from the Beacon website.
- Updates the `Schedule` tab in Google Sheets.
- Removes past screenings.
- Deduplicates events and warns about duplicates.

#### Runtime Information

```bash
node findRuntimes.js
```

- Prompts to replace or update the `Runtimes` tab (5s timeout).
- Extracts runtime from each film's page.
- Skips already processed films.
- Deduplicates runtimes and warns about duplicates.

#### Calendar Sync

```bash
node updateGCal.js
```

- Deletes all upcoming events from your Google Calendar.
- Creates new events with:
  - Proper title formatting
  - Runtime information (adds 15 minutes to runtime if available, otherwise defaults to 2 hours)
  - Series grouping (if available)
  - Venue location
  - Film page URL
- Uses a Google service account for authentication (no OAuth2 or browser authorization required).
- The service account email must be added as an editor to your target Google Calendar.

## Troubleshooting

### Authentication Issues

If you encounter authentication errors, verify the following:

- **Service Account File**: Ensure `beacon-calendar-update.json` is present and valid in your project root
- **Calendar ID**: Verify `CALENDAR_ID` is set correctly in your `.env` file
- **Google Sheet ID**: Verify `SHEET_ID` is set correctly in your `.env` file
- **Calendar Permissions**: The service account email must be added as an editor to your Google Calendar
- **Sheet Permissions**: The service account email must be added as an editor to your Google Sheet
- **API Access**: Confirm the Google Calendar API and Sheets API are enabled for your Google Cloud project
- **Credentials Format**: Check that the service account JSON contains `client_email` and `private_key` fields

### File and Directory Issues

- **Missing Directories**: The script will create the `logs` directory automatically
- **Permission Errors**: Ensure the script has read/write access to the project directory

### Runtime Issues

- **Node.js Version**: Scripts require Node.js 14+ and may not work with older versions
- **Puppeteer/Chromium Issues**: If Puppeteer fails to launch, install missing system dependencies (see `PUPPETEER_RENDER_SETUP.md`)
- **Network Timeouts**: The `navigateWithRetry()` utility handles most timeout issues automatically

## License

GNU General Public License v3.0

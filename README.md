# Beacon Cinema Calendar Sync

This project automates scraping [The Beacon Cinema](https://thebeacon.film/calendar) schedule and syncing it to Google Calendar, including runtime information and film series details, using Google Sheets for data management.

## Features

- **Film Series Management**: Scrapes film series information and member films from series pages
- **Schedule Extraction**: Extracts current film schedules with dates, times, and links
- **Runtime Discovery**: Automatically finds and records film runtime information
- **Google Calendar Integration**: Syncs with Google Calendar, including:
  - Film titles with proper capitalization
  - Runtime information (adds 15 minutes buffer, defaults to 2 hours if unknown)
  - Film series associations
  - Venue location (The Beacon Cinema)
  - Direct links to film detail pages
- **Google Sheets Integration**: Stores and manages data in Google Sheets for series, schedules, and runtimes
- **Interactive Execution**: User prompts with timeouts (default 5 seconds)
- **Comprehensive Error Handling**: Robust error handling with detailed logging
- **Data Deduplication**: Automatic deduplication of events and data with warnings
- **Parameter Validation**: Comprehensive input validation across all functions
- **Shared Utilities**: Centralized timeout handling and Google Sheets operations

## Prerequisites

- Node.js 14 or higher (recommended)
- A Google Cloud project with:
  - Calendar API and Sheets API enabled
  - A service account with a JSON key (downloaded as `beacon-calendar-update.json`)
- The service account email must be added as an editor to your target Google Calendar (in the Google Calendar UI).
- You must create and share a Google Sheet for storing all data (see below).

> **Tip:** All scripts must be run from the project root (`jcal`) using Node.js (not in a browser).

## Dependencies

- Install all dependencies via `npm install`:
  - `puppeteer` (for web scraping; downloads Chromium automatically, but Linux may require extra system libraries—see [Puppeteer troubleshooting](https://pptr.dev/troubleshooting/))
  - `googleapis` (for Google Calendar and Sheets API)
  - `dotenv` (for environment variables)

## Required Files and Google Sheets Setup

### Google Sheets Tab Summary

| Tab Name      | Purpose                                                      |
|--------------|--------------------------------------------------------------|
| seriesIndex  | Film series definitions (name, URL, tag)                     |
| series       | Auto-populated: member films for each series                 |
| schedule     | Auto-populated: current film schedule (title, date, time)    |
| runtimes     | Auto-populated: runtime info for each film                   |

- The following files and directories are required:
  - `logs/`: Directory for log files (created automatically if missing).
  - `beacon-calendar-update.json`: Google service account credentials.
  - `.env`: Environment configuration.

### Setting Up Google Sheets

1. **Create a new Google Sheet** in your Google Drive.
2. **Add the following tabs (bottom of the sheet):**

- `seriesIndex` (for your film series definitions)
- `series` (auto-populated by scripts)
- `schedule` (auto-populated by scripts)
- `runtimes` (auto-populated by scripts)

3. **Share the sheet** with your service account email (found in `beacon-calendar-update.json`) as an editor.
   - **How to find your service account email:**
     - In the [Google Cloud Console](https://console.cloud.google.com/), go to **IAM & Admin > Service Accounts**.
     - Locate your service account and copy the **Email** field (usually ends with `@<project>.iam.gserviceaccount.com`).

## Web Interface

You can run scripts and view logs in real time using the built-in web interface:

1. Start the server:

  ```bash
  npm start
  ```

  This will launch the Express server (see `webserver.js`) at [http://localhost:3000](http://localhost:3000).

2. Open your browser and go to [http://localhost:3000](http://localhost:3000).

3. Use the buttons to run any script (`fullUpdate.js`, `beaconSeries.js`, etc.).

- The log output will appear live in the "Live Log Output" section.

**Note:** The web interface is for local use and does not require authentication. All scripts run in the server environment and output logs to both the browser and log files.
4. **Get the Sheet ID** from the URL (the part after `/d/` and before `/edit`).
5. **Set the Sheet ID in your `.env` file:**

  ```env
  SHEET_ID=your_google_sheet_id
  ```

6. **Populate the `seriesIndex` tab** with your film series definitions:

- Columns: `seriesName`, `seriesURL`, `seriesTag`
- Example:

    | seriesName | seriesURL | seriesTag |
    |------------|-----------|-----------|
    | THE ABSURD MYSTERY... | <https://thebeacon.film/programs/entry/the-absurd-mystery>... | lynchian |
    | TO LIVE IS TO DREAM... | <https://thebeacon.film/programs/entry/to-live-is-to-dream>... | davidlynch |

- You can add or remove series as needed.

7. **Leave the other tabs empty**; scripts will populate them automatically.

## Logging

All scripts use a centralized logging system (`logger.js`) that writes to both console and log files with timestamp formatting and error handling.

### Usage

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

This script sequentially executes the following steps, prompting before each (with a 5-second timeout defaulting to yes):

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
- **Puppeteer/Chromium Issues**: If Puppeteer fails to launch, install missing system dependencies
- **Network Timeouts**: The `navigateWithRetry()` utility handles most timeout issues automatically

## License

GNU General Public License v3.0

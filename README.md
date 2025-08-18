# Beacon Cinema Calendar Sync

This project automates scraping [The Beacon Cinema](https://thebeacon.film/calendar) schedule and syncing it to Google Calendar, including runtime information and film series details.

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
- **Interactive Execution**: User prompts with timeouts (default 5 seconds)
- **Comprehensive Error Handling**: Robust error handling with detailed logging
- **Data Deduplication**: Automatic deduplication of events and data with warnings
- **Parameter Validation**: Comprehensive input validation across all functions
- **Shared Utilities**: Centralized timeout handling and CSV operations

## Prerequisites

- Node.js 14 or higher (recommended)
- A Google Cloud project with:
  - Calendar API enabled
  - A service account with a JSON key (downloaded as beacon-calendar-update.json)
- The service account email must be added as an editor to your target Google Calendar (in the Google Calendar UI).

> **Tip:** All scripts must be run from the project root (`jcal`) using Node.js (not in a browser).

## Dependencies

- Install all dependencies via `npm install`:
  - `puppeteer` (for web scraping; downloads Chromium automatically, but Linux may require extra system libraries—see [Puppeteer troubleshooting](https://pptr.dev/troubleshooting/))
  - `googleapis` (for Google Calendar API)
  - `csv-parser`, `csv-writer` (for CSV handling)
  - `dotenv` (for environment variables)

## Required Files and Directory Structure

- The following files and directories are required:
  - `beacon-calendar-update.json`: Google service account credentials.
  - `.env`: Environment configuration.
  - `files/seriesIndex.csv`: Film series definitions.
  - `files/series.csv`, `files/schedule.csv`, `files/runtimes.csv` (auto-created/updated by scripts as needed)
- If a required CSV file is missing or empty, scripts will create it with the correct header row, but you must populate `seriesIndex.csv` yourself.

## Logging

All scripts use a centralized logging system (`logger.js`) that writes to both console and log files with timestamp formatting and error handling.

### Usage

```javascript
const logger = require('./logger')('scriptName');

// Available logging levels from most to least severe
logger.error('Error message', optionalErrorObject);  // Critical errors with optional Error object
logger.warn('Warning message');                      // Non-critical issues and warnings  
logger.info('Info message');                         // General operational information
logger.debug('Debug message');                       // Detailed debugging information

// Log execution summary at end of script (recommended)
logger.summary(processedCount, skippedCount, errorCount);
```

### Log File Location and Format

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
[2025-08-18T21:58:40.739Z] [INFO] Found 14 series in files/seriesIndex.csv.
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

## Error Handling & Utilities

The project includes robust error handling and shared utilities:

### Error Handling (`errorHandler.js`)

- **Global Error Handling**: Catches unhandled rejections and exceptions
- **Standardized Error Reporting**: Consistent error formatting across all scripts
- **Parameter Validation**: All error handling functions validate their inputs
- **Graceful Degradation**: Scripts can continue or exit based on error severity

### Shared Utilities (`utils.js`)

- **Network Timeout Handling**: `navigateWithRetry()` with 60-second timeout and retry logic
- **CSV Operations**: Header validation, deduplication, and file checking
- **Parameter Validation**: Comprehensive input validation for all utility functions
- **File Management**: Robust file existence checking with detailed error messages

## CSV File Handling

- All scripts ensure the correct header row is present in each CSV file.
- Malformed or incomplete rows in CSVs will be skipped with a warning.
- Duplicate rows are detected and deduplicated, with warnings printed.
- CSVs may be appended to or overwritten depending on script prompts and workflow.

> **Note:** Running scripts multiple times may overwrite or append to CSVs, depending on prompts.

## Script Outputs

- `files/series.csv`: List of film titles and their associated series tags, updated by beaconSeries.js.
- `files/schedule.csv`: The current schedule of films (title, date, time, URL, series tag), updated by beaconSchedule.js.
- `files/runtimes.csv`: Runtime information for each film, updated by findRuntimes.js.

## Updating or Resetting Data

- To reset runtimes, run `findRuntimes.js` and choose to replace `runtimes.csv` when prompted.
- To reset series data, edit or replace `files/seriesIndex.csv` and rerun `beaconSeries.js`.
- To clear all Google Calendar events and resync, run `updateGCal.js` or the full pipeline.

## Google Calendar Event Deletion

- Running `updateGCal.js` or `fullUpdate.js` will **delete all upcoming events** from the target Google Calendar before adding new ones from the current schedule. Make sure this is the desired behavior.

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
    - Enable the Calendar API.
    - Create a service account and download the JSON key as beacon-calendar-update.json to your project root.
    - In the Google Calendar web UI, share your target calendar with the service account email (as an editor).

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
        ```

        > **Important**: The `CALENDAR_ID` must be the calendar where your service account has been added as an editor.

3. **Create `files` Directory**:

    ```bash
    mkdir files
    ```

4. **Set up `files/seriesIndex.csv`**:
    - This file contains the list of series with their names, URLs, and tags.
    - **You must create and edit this file manually before running any scripts.** Each row should have:
        - `seriesName`: The name of the series (can be quoted if it contains commas)
        - `seriesURL`: The URL of the series/program page on the Beacon site
        - `seriesTag`: A short, unique tag for the series (used for grouping)
    - Example:

        ```csv
        seriesName,seriesURL,seriesTag
        "THE ABSURD MYSTERY OF THE STRANGE FORCES OF EXISTENCE: ""LYNCHIAN"" CINEMA",https://thebeacon.film/programs/entry/the-absurd-mystery-of-the-strange-forces-of-existence-lynchian-cinema,lynchian
        TO LIVE IS TO DREAM: A NORTHWEST TRIBUTE TO DAVID LYNCH,https://thebeacon.film/programs/entry/to-live-is-to-dream-a-northwest-tribute-to-david-lynch,davidlynch
        ```

    - You can add or remove series as needed.

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

1. `beaconSeries.js` - Updates film series data from `files/seriesIndex.csv` and writes to `files/series.csv`.
2. `beaconSchedule.js` - Scrapes the current schedule and writes to `files/schedule.csv`.
3. `findRuntimes.js` - Extracts runtime information for scheduled films and writes to `files/runtimes.csv`.
4. `updateGCal.js` - Updates Google Calendar with the latest schedule.

### Individual Scripts

You can also run each script individually as needed:

```bash
node beaconSeries.js
```

- Scrapes film titles from each series page listed in `files/seriesIndex.csv`.
- Updates `files/series.csv`.
- Removes outdated entries for each SeriesTag before adding new ones.
- Deduplicates titles and warns about duplicates.

#### Schedule Update

```bash
node beaconSchedule.js
```

- Scrapes the current calendar from the Beacon website.
- Updates `files/schedule.csv`.
- Removes past screenings.
- Deduplicates events and warns about duplicates.

#### Runtime Information

```bash
node findRuntimes.js
```

- Prompts to replace or update `files/runtimes.csv` (5s timeout).
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
- Provides troubleshooting tips for common Google authentication errors.

## Script Overview

| Script             | Purpose                                                                                 |
|--------------------|-----------------------------------------------------------------------------------------|
| beaconSeries.js    | Scrapes film titles for each series and updates `files/series.csv`                      |
| beaconSchedule.js  | Scrapes the Beacon calendar and updates `files/schedule.csv`                            |
| findRuntimes.js    | Extracts runtime info for each scheduled film and updates `files/runtimes.csv`          |
| updateGCal.js      | Syncs the schedule to Google Calendar (deletes all upcoming events, then adds new ones) |
| fullUpdate.js      | Runs all the above scripts in sequence, with prompts                                    |

## Troubleshooting

### Google Authentication Issues

If you encounter authentication errors, verify the following:

- **Service Account File**: Ensure `beacon-calendar-update.json` is present and valid in your project root
- **Calendar ID**: Verify `CALENDAR_ID` is set correctly in your `.env` file
- **Calendar Permissions**: The service account email must be added as an editor to your Google Calendar
- **API Access**: Confirm the Google Calendar API is enabled for your Google Cloud project
- **Credentials Format**: Check that the service account JSON contains `client_email` and `private_key` fields

### File and Directory Issues

- **Missing Directories**: The script will create the `files` and `logs` directories automatically
- **CSV File Issues**: Required files like `seriesIndex.csv` must be created manually before first run
- **Permission Errors**: Ensure the script has read/write access to the project directory

### Runtime Issues

- **Node.js Version**: Scripts require Node.js 14+ and may not work with older versions  
- **Puppeteer/Chromium Issues**: If Puppeteer fails to launch, install missing system dependencies
- **Network Timeouts**: The `navigateWithRetry()` utility handles most timeout issues automatically
- **CSV Formatting**: Scripts will warn about malformed or duplicate rows in CSV files

### Error Messages

- **Parameter Validation Errors**: Check function calls for correct parameter types and values
- **Missing Dependencies**: Run `npm install` to ensure all packages are installed
- **Port Conflicts**: Close other applications using Chrome/Chromium if Puppeteer fails to launch

## License

GNU General Public License v3.0

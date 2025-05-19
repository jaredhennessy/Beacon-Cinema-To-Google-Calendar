# Beacon Cinema Calendar Sync

This project automates scraping [The Beacon Cinema](https://thebeacon.film/calendar) schedule and syncing it to Google Calendar, including runtime information and film series details.

## Features

- Scrapes film series information and member films from series pages.
- Extracts film schedules and runtimes.
- Syncs with Google Calendar, including:
  - Film titles with proper capitalization
  - Runtime information
  - Film series groupings
  - Venue location
  - Links to film pages
- Interactive execution with timeouts (default 5 seconds).
- Comprehensive error handling and logging.
- Deduplication of events and data, with warnings for duplicates.

## Prerequisites

- Node.js 14 or higher (enforced by scripts; scripts will exit if version is too old)
- A Google Cloud project with:
  - Calendar API enabled
  - OAuth 2.0 credentials configured
- Access to modify a Google Calendar

> **Tip:** All scripts must be run from the project root (`jcal`) using Node.js (not in a browser).

## Dependencies

- Install all dependencies via `npm install`:
  - `puppeteer` (for web scraping; downloads Chromium automatically, but Linux may require extra system libraries—see [Puppeteer troubleshooting](https://pptr.dev/troubleshooting/))
  - `googleapis` (for Google Calendar API)
  - `csv-parser`, `csv-writer` (for CSV handling)
  - `dotenv` (for environment variables)

## Required Files and Directory Structure

- The following files and directories are required:
  - `credentials.json` (Google OAuth2 credentials, in project root)
  - `.env` (environment variables, in project root)
  - `files/` directory (all CSVs go here)
  - `files/seriesIndex.csv` (must be created/edited by you)
  - `files/series.csv`, `files/schedule.csv`, `files/runtimes.csv` (auto-created/updated by scripts as needed)
- If a required CSV file is missing or empty, scripts will create it with the correct header.

## CSV File Handling

- All scripts ensure the correct header row is present in each CSV file.
- Malformed or incomplete rows in CSVs will be skipped with a warning.
- Duplicate rows are detected and deduplicated, with warnings printed.
- CSVs may be appended to or overwritten depending on script prompts and workflow.

> **Note:** Running scripts multiple times may overwrite or append to CSVs, depending on prompts.

## Script Outputs

- `files/series.csv`: List of film titles and their associated series tags, updated by `beaconSeries.js`.
- `files/schedule.csv`: The current schedule of films (title, date, time, URL, series tag), updated by `beaconSchedule.js`.
- `files/runtimes.csv`: Runtime information for each film, updated by `findRuntimes.js`.
- `token.json`: Google OAuth2 token, created after first successful authentication.

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
    - Go to [Google Cloud Console](https://console.cloud.google.com/).
    - Enable the Calendar API.
    - Create OAuth 2.0 credentials:
        - Go to "Credentials" and click "Create Credentials" > "OAuth 2.0 Client IDs".
        - Set the "Application type" to "Web application".
        - Set the redirect URI to `http://localhost:3000`.
        - Download the credentials as `credentials.json` and place it in the project root.

2. **Environment Configuration**:
    - Create a `.env` file in the project root with the following content:

        ```env
        CALENDAR_ID=your_calendar_id
        OAUTH2_REDIRECT_URI=http://localhost:3000
        TIME_ZONE=America/Los_Angeles
        ```

        Replace `your_calendar_id` with the ID of the Google Calendar you want to update.

3. **Create `files` Directory**:

    ```bash
    mkdir files
    ```

4. **Set up `files/seriesIndex.csv`**:
    - This file contains the list of series with their names, URLs, and tags.
    - You must create and edit this file manually. Each row should have:
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

## Usage

### Quick Start

Experienced users can run the full pipeline with:

```bash
npm install
node fullUpdate.js
```

This will prompt before each step and update all data and your Google Calendar.

### Full Update Pipeline (Recommended)

Run the complete update process:

```bash
node fullUpdate.js
```

This script sequentially executes the following steps, prompting before each:

1. `beaconSeries.js` - Updates film series data from `files/seriesIndex.csv` and writes to `files/series.csv`.
2. `beaconSchedule.js` - Scrapes the current schedule and writes to `files/schedule.csv`.
3. `findRuntimes.js` - Extracts runtime information for scheduled films and writes to `files/runtimes.csv`.
4. `updateGCal.js` - Updates Google Calendar with the latest schedule.

Each step prompts for confirmation with a 5-second timeout (defaults to yes).

### Individual Scripts

You can also run each script individually as needed:

#### Film Series Update

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
- Matches films to series using `files/series.csv`.
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
- Handles OAuth2 flow if needed (opens a browser for authorization if no valid token is found).
- Provides troubleshooting tips for common Google authentication errors.

## Script Overview

| Script             | Purpose                                                                                 |
|--------------------|-----------------------------------------------------------------------------------------|
| beaconSeries.js    | Scrapes film titles for each series and updates `files/series.csv`                      |
| beaconSchedule.js  | Scrapes the Beacon calendar and updates `files/schedule.csv`                            |
| findRuntimes.js    | Extracts runtime info for each scheduled film and updates `files/runtimes.csv`          |
| updateGCal.js      | Syncs the schedule to Google Calendar (deletes all upcoming events, then adds new ones) |
| fullUpdate.js      | Runs all the above scripts in sequence, with prompts                                    |

## File Structure

### Input Files

- `credentials.json`: Google OAuth2 credentials.
- `.env`: Environment configuration.
- `files/seriesIndex.csv`: Film series definitions.

### Working Files

- `files/series.csv`: Film-to-series relationships.
- `files/schedule.csv`: Current film schedule.
- `files/runtimes.csv`: Film runtime information.
- `token.json`: Google OAuth2 tokens.

## .gitignore and Sensitive Files

- `.gitignore` is set up to ignore sensitive files (`credentials.json`, `token.json`, `.env`) and all CSVs by default.
- Do not commit your credentials or tokens to version control.

## Troubleshooting

- **Google Authentication:** If you see authentication errors, delete `token.json` and re-run the script to reauthorize.
- **Missing Files/Directories:** Ensure you have created the `files` directory and at least `seriesIndex.csv`.
- **Node Version:** Scripts require Node.js 14+ and will exit if an older version is detected.
- **Puppeteer/Chromium Issues:** If Puppeteer fails to launch Chromium, check for missing system dependencies.
- **CSV Issues:** If you see warnings about malformed or duplicate rows, check your CSV files for formatting errors.

## License

GNU General Public License v3.0

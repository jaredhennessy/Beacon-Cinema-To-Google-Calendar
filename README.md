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
- Interactive execution with timeouts.
- Comprehensive error handling and logging.
- Deduplication of events and data.

## Prerequisites

- Node.js 14 or higher
- A Google Cloud project with:
  - Calendar API enabled
  - OAuth 2.0 credentials configured
- Access to modify a Google Calendar

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

        ```csv
        seriesName,seriesURL,seriesTag
        "Series Name","https://thebeacon.film/programs/entry/series-url","tag"
        ```

## Usage

### Full Update Pipeline

Run the complete update process:

```bash
node fullUpdate.js
```

This script sequentially executes the following steps:

1. `beaconSeries.js` - Updates film series data.
2. `beaconSchedule.js` - Scrapes the current schedule.
3. `findRuntimes.js` - Extracts runtime information.
4. `updateGCal.js` - Updates Google Calendar.

Each step prompts for confirmation with a 5-second timeout (defaults to yes).

### Individual Scripts

#### Film Series Update

```bash
node beaconSeries.js
```

- Scrapes film titles from series pages.
- Updates `files/series.csv`.
- Removes outdated entries.

#### Schedule Update

```bash
node beaconSchedule.js
```

- Scrapes the current calendar.
- Updates `files/schedule.csv`.
- Removes past screenings.
- Matches films to series.

#### Runtime Information

```bash
node findRuntimes.js
```

- Prompts to replace or update `files/runtimes.csv`.
- Extracts runtime from film pages.
- Skips already processed films.

#### Calendar Sync

```bash
node updateGCal.js
```

- Deletes all upcoming events.
- Creates new events with:
  - Proper title formatting
  - Runtime information
  - Series grouping
  - Venue location
  - Film page URL
- Handles OAuth2 flow if needed.

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

## Error Handling

- All scripts include detailed error logging.
- Authentication troubleshooting guidance.
- CSV header validation.
- Duplicate detection.
- Missing file/directory checks.

## Notes

- The OAuth2 server runs on port 3000 by default.
- First run requires Google Calendar authorization.
- All dates/times use ISO 8601 format.
- Films without runtimes default to 2-hour events.
- Past events are automatically removed.
- Duplicate events are automatically deduplicated.

## License

GNU General Public License v3.0

# Beacon Cinema to Google Calendar

This project automates the process of scraping event data from [The Beacon Cinema Film Calendar](https://thebeacon.film/calendar) and updating a Google Calendar with the scraped events.

## Scripts Overview

### 1. `scrapeBeacon.js`

This script uses Puppeteer to scrape event data from The Beacon Film Calendar and processes it into CSV files:

- **`films.csv`**: Contains unique film titles extracted from the website.
- **`lynchian.csv`**: A list of titles included in the Beacon's series "Lynchian" films.
- **`schedule.csv`**: Contains the final schedule of events, including:
  - Title
  - Date
  - Time
  - URL
  - Whether the event is "Lynchian" (`Y` or `N`).

#### Features of scrapeBeacon.js

- Filters out duplicate titles and irrelevant entries (e.g., "RENT THE BEACON").
- Ensures only new titles are appended to `films.csv`.
- Filters schedule data to include only events with dates >= today.
- Adds a "Lynchian" field to the schedule based on `lynchian.csv`.

---

### 2. `updateBeaconCalendar.js`

This script integrates with the Google Calendar API to manage events based on `schedule.csv`:

- Deletes all upcoming events in the specified Google Calendar.
- Reads the first five records from `schedule.csv` and creates events with:
  - Title
  - Start and end time (calculated with a default duration of 2 hours).
  - Description (includes "Lynchian" status and URL).
- Lists the next 10 events in the calendar for verification.

#### Key Features

- Validates event data (e.g., time format, required fields).
- Handles OAuth2 authentication with the Google Calendar API.
- Supports timezone configuration via `.env`.

---

#### Features of lynchianBeacon.js

- Deletes the existing `lynchian.csv` file before generating a new one.
- Extracts unique film titles from the "Lynchian" series page.
- Starts scraping from the title "LAURA" and excludes any content before it.

---

### 3. `beaconSeries.js`

This script processes series information from `seriesIndex.csv`, scrapes titles from the corresponding URLs, and updates `series.csv`:

- **`seriesIndex.csv`**: Contains the list of series with their names, URLs, and tags.
- **`series.csv`**: Stores the titles and their associated series tags.

#### Features of beaconSeries.js

- Reads all rows from `seriesIndex.csv`.
- For each series:
  - Scrapes titles from the provided URL.
  - Removes rows from `series.csv` where the `SeriesTag` matches the current series tag, but only if titles are successfully retrieved.
  - Appends the new titles with their `SeriesTag` to `series.csv`.
- Skips empty or whitespace-only titles and excludes specific titles like "?????? CINEMA".
- Logs detailed information about the scraping process, including the number of titles extracted.

#### Usage

1. Ensure `seriesIndex.csv` is populated with the following columns:
   - `seriesName`: The name of the series.
   - `seriesURL`: The URL to scrape titles from.
   - `seriesTag`: A unique tag for the series.

2. Run the script:

   ```bash
   node beaconSeries.js
   ```

3. The script will update `series.csv` with the latest titles for each series.

---

## Setup Instructions

### Prerequisites

1. **Node.js**: Install [Node.js](https://nodejs.org/).
2. **Google Cloud Project**: Create a project in the [Google Cloud Console](https://console.cloud.google.com/).

### Setting Up the Google Calendar API

1. Enable the **Google Calendar API** for your project:
   - Go to the [Google Calendar API page](https://console.cloud.google.com/apis/library/calendar.googleapis.com).
   - Click "Enable".
2. Create OAuth2 credentials:
   - Go to the [Credentials page](https://console.cloud.google.com/apis/credentials).
   - Click "Create Credentials" > "OAuth 2.0 Client IDs".
   - Set the redirect URI to `http://localhost:3000` (for scripts running locally or the URI of the server hosting these scripts).
   - Download the `credentials.json` file and place it in the project directory.
3. Set up your `.env` file:
   - Add your `CALENDAR_ID` (found in your Google Calendar settings).
   - Add the `OAUTH2_REDIRECT_URI` (e.g., `http://localhost:3000`).

### Installing Dependencies

Run the following command to install required packages:

```bash
npm install
```

### Running the Scripts

1. **Scrape Event Data**:

   ```bash
   node scrapeBeacon.js
   ```

   This will generate or update `films.csv` and `schedule.csv`.

2. **Update Google Calendar**:

   ```bash
   node updateBeaconCalendar.js
   ```

   Follow the OAuth2 authorization flow if prompted.

3. **Process Series Information**:

   ```bash
   node beaconSeries.js
   ```

   This will update `series.csv` with the latest titles for each series.

---

## Environment Variables

The `.env` file should include the following variables:

```properties
API_KEY=your_google_api_key
CALENDAR_ID=your_calendar_id
TIME_ZONE=your_time_zone
OAUTH2_REDIRECT_URI=http://localhost:3000 (for scripts running locally or the URI of the server hosting these scripts)
```

---

## References

- [Google Calendar API Documentation](https://developers.google.com/calendar)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Puppeteer Documentation](https://pptr.dev/)

---

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.

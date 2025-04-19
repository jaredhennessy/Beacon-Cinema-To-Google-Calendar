# Beacon Cinema to Google Calendar

This project automates the process of scraping event data from [The Beacon Cinema Film Calendar](https://thebeacon.film/calendar) and updating a Google Calendar with the scraped events.

## Codebase Overview

### Scripts

1. **`beaconSeries.js`**  
   Processes series information from `files/seriesIndex.csv`, scrapes titles from the corresponding URLs, and updates `files/series.csv`:
   - Reads all rows from `files/seriesIndex.csv`.
   - Scrapes titles from the provided URLs.
   - Updates `files/series.csv` with the latest titles and their associated `SeriesTag`.

2. **`beaconSchedule.js`**  
   Scrapes event data from The Beacon Film Calendar and updates `files/schedule.csv`:
   - Executes `beaconSeries.js` at the start to ensure `files/series.csv` is up-to-date.
   - Scrapes event data from the website.
   - Filters out events with the title `"RENT THE BEACON"`.
   - Updates `files/schedule.csv` with event details, including:
     - Title
     - Date
     - Time
     - URL
     - SeriesTag (from `files/series.csv`)
     - DateRecorded (timestamp of when the record was added).

3. **`updateGoogleCalendar.js`**  
   Integrates with the Google Calendar API to manage events based on `files/schedule.csv`:
   - Deletes all upcoming events in the specified Google Calendar.
   - Creates events for the first five records in `files/schedule.csv`.
   - Lists the next 10 events in the calendar for verification.

### CSV Files

1. **`files/seriesIndex.csv`**  
   Contains the list of series with their names, URLs, and tags. Example:

   ```csv
   seriesName,seriesURL,seriesTag
   "THE ABSURD MYSTERY OF THE STRANGE FORCES OF EXISTENCE: ""LYNCHIAN” CINEMA""",https://thebeacon.film/programs/entry/the-absurd-mystery-of-the-strange-forces-of-existence-lynchian-cinema,lynchian
   "TO LIVE IS TO DREAM: A NORTHWEST TRIBUTE TO DAVID LYNCH",https://thebeacon.film/programs/entry/to-live-is-to-dream-a-northwest-tribute-to-david-lynch,lynch
   ```

2. **`files/series.csv`**  
   Stores titles and their associated `SeriesTag` scraped from the URLs in `files/seriesIndex.csv`. Example:

   ```csv
   Title,SeriesTag
   LAURA,lynchian
   SUNSET BOULEVARD,lynchian
   SMOOTH TALK,lynchian
   ```

3. **`files/schedule.csv`**  
   Contains the final schedule of events scraped from The Beacon Film Calendar. Example:

   ```csv
   Title,Date,Time,URL,SeriesTag,DateRecorded
   BATANG WEST SIDE,2025-04-19,16:00,https://thebeacon.film/calendar/movie/batang-west-side,,2025-04-19T21:51:48.844Z
   THE RED HOUSE,2025-04-20,17:00,https://thebeacon.film/calendar/movie/the-red-house,lynchian,2025-04-19T21:51:48.844Z
   ```

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

---

## Running the Scripts

1. **Process Series Information**:

   ```bash
   node beaconSeries.js
   ```

   This will update `files/series.csv` with the latest titles for each series.

2. **Scrape Event Data**:

   ```bash
   node beaconSchedule.js
   ```

   This will generate or update `files/schedule.csv` with the latest event data.

3. **Update Google Calendar**:

   ```bash
   node updateGoogleCalendar.js
   ```

   Follow the OAuth2 authorization flow if prompted.

---

## Environment Variables

The `.env` file should include the following variables:

```properties
API_KEY=your_google_api_key
CALENDAR_ID=your_calendar_id
TIME_ZONE=your_time_zone
OAUTH2_REDIRECT_URI=http://localhost:3000
```

---

## References

- [Google Calendar API Documentation](https://developers.google.com/calendar)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Puppeteer Documentation](https://pptr.dev/)

---

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.

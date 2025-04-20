# Beacon Cinema to Google Calendar

This project automates the process of scraping event data from [The Beacon Cinema Film Calendar](https://thebeacon.film/calendar) and updating a Google Calendar with the scraped events.

## Codebase Overview

### Scripts

1. **`beaconSeries.js`**  
   Processes series information from `files/seriesIndex.csv`, scrapes titles from the corresponding URLs, and updates `files/series.csv`:
   - Reads all rows from `files/seriesIndex.csv`.
   - Scrapes titles from the provided URLs.
   - Updates `files/series.csv` with the latest titles and their associated `SeriesTag`.
   - Removes outdated rows from `files/series.csv` for the same `SeriesTag` before appending new rows.
   - Ensures duplicate titles are not added.

2. **`beaconSchedule.js`**  
   Scrapes event data from The Beacon Film Calendar and updates `files/schedule.csv`:
   - Prompts the user to decide whether to execute `beaconSeries.js` to ensure `files/series.csv` is up-to-date.
   - Scrapes event data from the website, including:
     - Title
     - Date
     - Time
     - URL
   - Filters out events with the title `"RENT THE BEACON"`.
   - Matches titles with `SeriesTag` from `files/series.csv`.
   - Adds a `DateRecorded` timestamp to each record.
   - Removes outdated records from `files/schedule.csv` where the event date is in the past.
   - Writes the updated schedule to `files/schedule.csv`.

3. **`updateGCal.js`**  
   Integrates with the Google Calendar API to manage events based on `files/schedule.csv`:
   - Deletes all upcoming events in the specified Google Calendar.
   - Prompts the user for the number of events to create or defaults to creating all events.
   - Creates events based on the records in `files/schedule.csv`, including:
     - Title
     - Start and end times
     - Location
     - Description (includes the series name and URL if available).
   - Validates and formats event data before creating events.

### CSV Files

1. **`files/seriesIndex.csv`**  
   Contains the list of series with their names, URLs, and tags. Example:

   ```csv
   seriesName,seriesURL,seriesTag
   "THE ABSURD MYSTERY OF THE STRANGE FORCES OF EXISTENCE: ""LYNCHIAN"" CINEMA",https://thebeacon.film/programs/entry/the-absurd-mystery-of-the-strange-forces-of-existence-lynchian-cinema,lynchian
   TO LIVE IS TO DREAM: A NORTHWEST TRIBUTE TO DAVID LYNCH,https://thebeacon.film/programs/entry/to-live-is-to-dream-a-northwest-tribute-to-david-lynch,davidlynch
   THE FILMS OF FREDERICK WISEMAN,https://thebeacon.film/programs/entry/the-films-of-frederick-wiseman,wiseman
   "Seattle's premiere ""blindfolded"" screening series",https://thebeacon.film/calendar/movie/blindfold,secret
   ```

2. **`files/series.csv`**  
   Stores titles and their associated `SeriesTag` scraped from the URLs in `files/seriesIndex.csv`. Example:

   ```csv
   Title,SeriesTag,DateRecorded
   THE RED HOUSE,lynchian,2025-04-20T00:20:53.541Z
   DAVID LYNCH’S RONNIE ROCKET: A LIVE TABLE READ,davidlynch,2025-04-20T00:20:57.176Z
   LAW AND ORDER,wiseman,2025-04-20T00:20:59.918Z
   ```

3. **`files/schedule.csv`**  
   Contains the final schedule of events scraped from The Beacon Film Calendar. Example:

   ```csv
   Title,Date,Time,URL,SeriesTag,DateRecorded
   THE RED HOUSE,2025-04-20,17:00,https://thebeacon.film/calendar/movie/the-red-house,lynchian,2025-04-20T00:21:09.620Z
   DAVID LYNCH’S RONNIE ROCKET: A LIVE TABLE READ,2025-04-27,17:00,https://thebeacon.film/calendar/movie/david-lynchs-ronnie-rocket-a-live-table-read,davidlynch,2025-04-20T00:21:09.620Z
   LAW AND ORDER,2025-05-14,19:30,https://thebeacon.film/calendar/movie/law-and-order,wiseman,2025-04-20T00:21:09.620Z
   ?????? CINEMA,2025-04-23,19:30,https://thebeacon.film/calendar/movie/blindfold,secret,2025-04-20T00:21:09.620Z
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
   node updateGCal.js
   ```

   Follow the OAuth2 authorization flow if prompted. You will be asked how many events to create or can press Enter to create all events.

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

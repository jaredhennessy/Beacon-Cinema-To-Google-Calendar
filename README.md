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
   - Removes future screenings from `files/schedule.csv` before writing new data.
   - Writes the updated schedule to `files/schedule.csv`.

3. **`findRuntimes.js`**  
   Extracts runtime information for events listed in `files/schedule.csv` and updates `files/runtimes.csv`:
   - Reads `files/schedule.csv` to collect unique URLs for events.
   - Skips titles already present in `files/runtimes.csv` with a non-empty `Runtime` value.
   - Browses to each URL and looks for runtime information on the page, extracting the relevant text.
   - Prompts the user to decide whether to replace the existing `files/runtimes.csv`:
     - If the user chooses to replace, the file is deleted before proceeding.
     - If the user does not respond within 5 seconds, the script proceeds without replacing the file.
   - Writes the extracted runtimes to `files/runtimes.csv` with two fields:
     - `Title`: The title of the event.
     - `Runtime`: The runtime extracted from the corresponding URL.

4. **`updateGCal.js`**  
   Integrates with the Google Calendar API to manage events based on `files/schedule.csv`:
   - Deletes all upcoming events in the specified Google Calendar.
   - Prompts the user for the number of events to create or defaults to creating all events.
   - Creates events based on the records in `files/schedule.csv`, including:
     - Title
     - Start and end times
     - Location
     - Description (includes the series name and URL if available).
   - Validates and formats event data before creating events.
   - If no token is found in `token.json`, the script starts the OAuth2 authorization flow:
     - The user is directed to a URL to authorize the app.
     - After successful authorization, the token is stored in `token.json`.
     - The script logs the message:  
       ```
       Token stored to token.json
       Please re-run the script now that the token has been created.
       ```
     - The user must re-run the script after the token is generated to proceed with calendar operations.

### CSV Files

All timestamps are in ISO 8601 format.

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
   ```

4. **`files/runtimes.csv`**  
   Contains runtime information for events listed in `files/schedule.csv`. Example:

   ```csv
   Title,Runtime
   THE RED HOUSE,100 minutes
   CEMETERY OF SPLENDOR,122 minutes
   RED ROCK WEST,98 minutes
   ```

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
   - Add the `OAUTH2_REDIRECT_URI` (e.g., `http://localhost:3000` for scripts running locally or the URI of the server hosting these scripts).

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

3. **Extract Runtimes**:

   ```bash
   node findRuntimes.js
   ```

   This will extract runtime information for events in `files/schedule.csv` and update `files/runtimes.csv`.

4. **Update Google Calendar**:

   ```bash
   node updateGCal.js
   ```

   This will update the designated Google Calendar or run the authorization process if necessary.

---

## Environment Variables

The `.env` file should include the following variables:

```properties
CALENDAR_ID=your_calendar_id
OAUTH2_REDIRECT_URI=your_redirect_uri
TIME_ZONE=your_time_zone
```

---

## References

- [Google Calendar API Documentation](https://developers.google.com/calendar)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Puppeteer Documentation](https://pptr.dev/)

---

## License

This project is licensed under the GNU General Public License v3.0. See the [LICENSE](LICENSE) file for details.

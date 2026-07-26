# Beacon Cinema Calendar Sync

Automates scraping [The Beacon Cinema](https://thebeacon.film/calendar) schedule and
syncing it to Google Calendar, including runtime and film series details, using Google
Sheets for data management.

## Summary

This project scrapes film series and schedule data from The Beacon Cinema, stores it in
Google Sheets (`seriesIndex`, `series`, `schedule`, `runtimes`), and syncs events to
Google Calendar. It supports both CLI and web interface usage, and is optimized for
deployment on Render.com.

## Features

- Automatic discovery of newly listed film series
- Schedule extraction, including date and time reconstruction
- Runtime discovery
- Google Calendar integration
- Google Sheets integration (`seriesIndex`, `series`, `schedule`, `runtimes`)
- Automated execution (CLI and web interface)
- Render.com ready (centralized Puppeteer config)
- Log rotation and comprehensive error handling
- Data deduplication and parameter validation

## Requirements

- **Node.js 20.x or 22.x.** The range is bounded at both ends by dependencies, so it is not
  a preference. `.node-version` pins 22, the newest version verified against this
  dependency tree.
  - **Lower bound**: `glob` requires `20 || >=22` (note it excludes 21), `puppeteer` and
    `express` require `>=18`, and `fs.readdirSync(dir, { recursive: true })` needs 18.17+.
    On an older runtime, `require('glob')` fails inside a `try/catch` in
    `getPuppeteerConfig()` that swallows the error, so Chrome discovery quietly falls back
    instead of telling you what went wrong.
  - **Upper bound**: Node 24 removed `SlowBuffer`, which `buffer-equal-constant-time` reads
    at module load. `googleapis` still reaches it through
    `google-auth-library → jws → jwa`, so on Node 24+ the Google auth stack throws
    `Cannot read properties of undefined (reading 'prototype')` before any of this
    project's code runs. Upgrading does not help — see
    [Runtime issues](#runtime-issues).
- A Google Cloud service account with the Calendar API and Sheets API enabled
- A Google Sheet and a Google Calendar, both shared with the service account

## Installation

```bash
git clone https://github.com/jaredhennessy/Beacon-Cinema-To-Google-Calendar.git
cd Beacon-Cinema-To-Google-Calendar
npm install
```

Puppeteer downloads Chrome during `npm install`. If it fails to launch later, see
[PUPPETEER_RENDER_SETUP.md](PUPPETEER_RENDER_SETUP.md).

## Configuration

### 1. Google Cloud setup

1. In the Google Cloud Console, enable the **Calendar API** and the **Sheets API**.
2. Create a service account and generate a JSON key.
3. Copy the values from that key into your `.env` file (see below). Credentials are read
   from environment variables — **no service account JSON file is read at runtime**.
4. In the Google Calendar UI, share your target calendar with the service account email
   as an editor.
5. Share your Google Sheet with the same service account email as an editor.

### 2. Environment variables

Create a `.env` file in the project root. Every variable in this first block is
**required** — `sheetsUtils.js` validates them at startup and exits if any are missing.

```bash
GOOGLE_TYPE=service_account
GOOGLE_PROJECT_ID=your-project-id
GOOGLE_PRIVATE_KEY_ID=your-key-id
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
GOOGLE_TOKEN_URI=https://oauth2.googleapis.com/token
GOOGLE_AUTH_PROVIDER_X509_CERT_URL=https://www.googleapis.com/oauth2/v1/certs
GOOGLE_CLIENT_X509_CERT_URL=your-cert-url
GOOGLE_UNIVERSE_DOMAIN=googleapis.com
```

`GOOGLE_PRIVATE_KEY` must contain the `-----BEGIN PRIVATE KEY-----` header. Keep it on one
line and wrap it in double quotes as shown; literal `\n` sequences are converted to real
newlines, so a single-line key works in `.env` and in the Render dashboard alike.

Also required, identifying which sheet and calendar to use:

```bash
# The Google Sheet to read and write. There is no default: the scripts refuse to
# start without it, rather than risk operating on the wrong sheet.
SPREADSHEET_ID=your_google_sheet_id

# The calendar to write to. Either the email-style ID or the long alphanumeric ID.
# The service account must be an editor on this calendar.
CALENDAR_ID=your_calendar_id@group.calendar.google.com
```

**Finding `SPREADSHEET_ID`:** open the sheet in a browser and copy the segment of the URL
between `/d/` and `/edit`.

```text
https://docs.google.com/spreadsheets/d/1AbC...XyZ/edit#gid=0
                                       ^^^^^^^^^^^ this is SPREADSHEET_ID
```

It is an identifier, not a secret — but it does name your data, so treat it the way you
would any other environment value and keep it out of version control. Trailing whitespace
is trimmed, because a stray space from a copy-paste would otherwise surface as an
unexplained 404 from the Sheets API.

Optional:

```bash
# IANA timezone name for calendar events. Default: America/Los_Angeles
TIME_ZONE=America/Los_Angeles

# Web interface port. Default: 3000
PORT=3000
```

See [Log configuration](#log-configuration) and [Deployment](#deployment-rendercom) for
the remaining optional variables.

### 3. Google Sheet structure

The sheet must contain four tabs, named exactly as below. Column headers are read by
name, so column order does not matter, but the headers must match.

| Tab | Columns | Written by |
| --- | --- | --- |
| `seriesIndex` | `seriesName`, `seriesURL`, `seriesTag` | `discoverSeries.js` |
| `series` | `Title`, `SeriesTag`, `DateRecorded` | `beaconSeries.js` |
| `schedule` | `Title`, `Date`, `Time`, `URL`, `SeriesTag`, `DateRecorded` | `beaconSchedule.js` |
| `runtimes` | `Title`, `Runtime` | `findRuntimes.js` |

`seriesIndex` maps a series page to a short tag. `series` maps each film title to that
tag, which is how `beaconSchedule.js` labels a screening, and how `updateGCal.js` looks
up the series name to put in an event description.

## Script Overview

| Script              | Purpose                                            |
|---------------------|----------------------------------------------------|
| discoverSeries.js   | Find newly listed series, update `seriesIndex` tab |
| beaconSeries.js     | Scrape series films, update `series` tab           |
| beaconSchedule.js   | Scrape schedule, update `schedule` tab             |
| findRuntimes.js     | Find runtimes, update `runtimes` tab               |
| updateGCal.js       | Sync schedule to Google Calendar                   |
| fullUpdate.js       | Run all five steps above in sequence               |
| webserver.js        | Web interface for running scripts and viewing logs |
| logManager.js       | Log rotation, cleanup and compression              |
| clearLogs.js        | Empty all log files                                |
| testPuppeteer.js    | Verify Puppeteer/Chrome setup                      |

## Usage

### Full pipeline (recommended)

```bash
node fullUpdate.js
```

Runs the complete pipeline without user prompts, which makes it suitable for automated
execution:

1. `discoverSeries.js` — adds newly listed series to `seriesIndex`.
2. `beaconSeries.js` — scrapes each series page and updates `series`.
3. `beaconSchedule.js` — scrapes the calendar and updates `schedule`.
4. `findRuntimes.js` — extracts runtimes and updates `runtimes`.
5. `updateGCal.js` — replaces upcoming Google Calendar events.

Step 1 runs before step 2 so a newly discovered series is scraped on the same pass rather
than a run later. A typical run takes about four minutes, most of it in steps 2 and 5.

If any step fails, the failure is logged and the pipeline stops.

### Web interface

```bash
npm start
# Open http://localhost:3000 in your browser
```

`npm start` launches the web interface only — it does **not** run the pipeline. Use the
buttons on the page, or `node fullUpdate.js`, to do that.

### Individual scripts

#### Series discovery

```bash
node discoverSeries.js
```

- Reads `/series` (all sections) and `/programs` (currently running only).
- Appends entries not already in `seriesIndex`, matching on URL.
- Leaves existing rows untouched, so hand-picked `seriesTag` values survive.
- Derives the tag for a new row from the URL slug, suffixing it if that tag is already
  taken by a different URL.
- Idempotent: re-running adds nothing once the sheet is current.

Only currently-running programs are taken from `/programs`, because its 40+ finished
programs list films that are never on the current calendar — scraping them was measured
to add nothing to tag coverage while costing several minutes per run. `/series` is small
and curated, so all of it is read.

#### Series details

```bash
node beaconSeries.js
```

- Scrapes the films listed on each series page in the `seriesIndex` tab.
- Replaces the rows for each scraped `SeriesTag`, so titles no longer listed are dropped.
- Tags absent from `seriesIndex` keep their existing rows, and a series that yields
  nothing keeps its rows rather than being emptied.
- Preserves each title's original `DateRecorded` as a first-seen timestamp.
- Skips a page that returns an HTTP error rather than storing its headings as films.

#### Schedule update

```bash
node beaconSchedule.js
```

- Scrapes the current calendar from the Beacon website.
- Rebuilds each date and time, which the page does not provide directly — see
  [Website structure dependencies](#website-structure-dependencies).
- Excludes theater rentals.
- Replaces the `schedule` tab with the scraped window, which drops past screenings.
- Leaves the tab untouched if nothing could be scraped, so a failed scrape cannot blank
  your calendar on the next `updateGCal.js` run.
- Deduplicates screenings, preferring the site's per-showtime ticket ID as the key.

#### Runtime information

```bash
node findRuntimes.js
```

- Prompts to replace existing runtimes, defaulting to No after 5 seconds. Answering Yes
  re-scrapes every scheduled film instead of skipping the ones already recorded.
- Extracts the runtime from each film's page.
- Merges results with the runtimes already in the sheet, so previously recorded values
  are kept. Freshly scraped values win on conflict.

A film whose page lists no runtime is left out, and `updateGCal.js` falls back to a
two-hour duration for it.

#### Calendar sync

```bash
node updateGCal.js
```

- Reads `schedule`, `runtimes` and `seriesIndex`. It never writes to the sheet.
- Skips rows dated before today, then deletes all upcoming events from your calendar.
- Creates new events with:
  - Title case formatting — see [Title formatting](#title-formatting)
  - Runtime plus 15 minutes when known, otherwise a 2 hour default
  - Series name, when the screening has a `SeriesTag`
  - Venue location
  - Film page URL
- Uses a Google service account (no OAuth2 or browser authorization required).

Only upcoming events are deleted, so past events created by earlier runs remain on the
calendar as history.

## Title formatting

The site stores every title in capitals, so `titleCase.js` reconstructs the casing before
events are created. Most of it is rule-based:

| Input | Output | Rule |
| --- | --- | --- |
| `ONCE UPON A TIME IN THE WEST` | Once Upon a Time in the West | Minor words stay lowercase mid-title |
| `TWIN PEAKS: FIRE WALK WITH ME` | Twin Peaks: Fire Walk with Me | …but are capitalized after a colon |
| `FRIDAY THE 13TH` | Friday the 13th | Ordinals are always lowercase |
| `THE THIRD-ANNUAL ALL-NIGHTER` | The Third-Annual All-Nighter | Each part of a hyphenated compound is capitalized |
| `THE OUT-OF-TOWNERS` | The Out-of-Towners | …except a minor word inside one |
| `VHS ÜBER ALLES` | VHS Über Alles | Accented initials are handled correctly |

Three things cannot be derived from an all-caps source, so they are listed in
[titleCasing.json](titleCasing.json):

- **`minorWords`** — the articles, conjunctions and short prepositions above.
- **`romanNumerals`** — `EXORCIST II` must not become "Exorcist Ii". An explicit list is
  used rather than a pattern, because ordinary words such as `MIX`, `DID`, `LIVID` and
  `CIVIL` are also valid roman numerals and a pattern would wreck them.
- **`exactCase`** — acronyms and names, keyed in lowercase: `"vhs": "VHS"`,
  `"mcpherson": "McPherson"`.

**`exactCase` is the only list expected to grow.** When a new film's acronym comes out
wrong, add one entry. Note that `la` and `us` are deliberately absent, because they are
the French article and the English pronoun far more often than Los Angeles or the United
States — adding them would corrupt titles like *À Nous La Liberté*.

The vocabulary is a JSON file rather than a Google Sheet tab on purpose: it is
presentation config rather than film data, it needs no network call at sync time (a failed
Sheet read would silently degrade every title), and its history is reviewable in git.
Editing it needs a commit and deploy; if you would rather change acronyms without one,
moving `exactCase` into a Sheet tab is a small change to `titleCase.js`.

**Run `npm test` after editing `titleCasing.json`.** The suite checks the vocabulary for
lowercase keys and for words listed in both `minorWords` and `exactCase`, and it asserts
that roman-numeral lookalikes such as *The Mix* and *A Civil Action* still come out as
words. See [Tests](#tests).

## Tests

```bash
npm test
```

Runs the unit suites in `test/`. They cover the two pure-logic modules whose failures are
**silent** — the pipeline reports success while writing wrong data:

| Suite | Covers | Why it matters |
| --- | --- | --- |
| `test/titleCase.test.js` | `titleCase.js` and the `titleCasing.json` vocabulary | A bad vocabulary edit corrupts every calendar title |
| `test/utils.test.js` | `parseCalendarDate()`, `parseTime12h()`, `addDaysToISODate()` | A year-inference regression puts every event a year off |

The suites are pure — no network, no Chrome, no Google APIs, no environment variables — so
they run in about a second. `test/utils.test.js` includes a sweep of every date across three
years at several reference offsets, which is the strongest guard on year inference, plus the
end-time arithmetic for shows running past midnight.

They use plain `assert` rather than a test framework, so there is no dependency to install
and each file stays runnable on its own with `node test/<name>.test.js`.

**Puppeteer is a separate, non-unit diagnostic.** It needs Chrome and internet access, so it
is deliberately not part of `npm test`:

```bash
node testPuppeteer.js
```

That script reports the Node version and platform, dumps the `PUPPETEER_*` variables,
inspects the Chrome cache directory before and after installation, prints the resolved
launch config, and then launches twice — once verbose and once through
`launchPuppeteerQuiet()`, the wrapper the scrapers actually use. Run it first when Puppeteer
fails on Render.

## Deployment (Render.com)

- See [render.yaml](render.yaml) and [PUPPETEER_RENDER_SETUP.md](PUPPETEER_RENDER_SETUP.md).
- **The Node version is pinned to 22 by [.node-version](.node-version), and it matters** —
  Render otherwise resolves a newer major, and Node 24+ breaks the Google auth stack at
  `require` time. A `NODE_VERSION` environment variable set in the dashboard takes
  precedence over the file, so make sure it is absent or also set to 22. Confirm the build
  log reports Node 22.x after deploying.
- **`render.yaml` does not declare the Google credential variables.** All 11 `GOOGLE_*`
  variables must be set in the Render dashboard, or the app exits on startup.
  `SPREADSHEET_ID`, `CALENDAR_ID` and `TIME_ZONE` are declared in `render.yaml` with
  `sync: false`, meaning Render prompts for their values rather than storing them in the
  repo — they still have to be filled in on the dashboard.
- Render runs in UTC. Date reconstruction is timezone-independent, but `updateGCal.js`
  compares against UTC "today", so a late-evening Pacific run can treat the same
  evening's screenings as already past.
- The free plan has an ephemeral filesystem, so `logs/` does not survive a restart.

### Puppeteer environment variables

All optional. `render.yaml` already sets the first one.

| Variable | Effect |
| --- | --- |
| `PUPPETEER_CACHE_DIR` | Where Chrome is installed and looked for. Defaults to `/opt/render/.cache/puppeteer` on Linux, or `.cache/puppeteer` under the project on Windows |
| `PUPPETEER_VERBOSE` | Set to `true` to log the resolved launch config and Chrome discovery on every run, without editing code |
| `PUPPETEER_EXECUTABLE_PATH` | Read by `testPuppeteer.js` when reporting the environment. `getPuppeteerConfig()` resolves the binary itself, so setting this does not override the launch path |
| `RENDER` | Set by Render automatically. Its presence, or a Linux platform, switches on the Render-specific Chrome path search |

## Logging & Maintenance

Logs are written to the `logs/` directory, one file per script:

- `discoverSeries.log`
- `beaconSeries.log`
- `beaconSchedule.log`
- `findRuntimes.log`
- `updateGCal.log`
- `utils.log`
- `fullUpdate.log`

Each run starts with a session marker, and entries share a consistent format:

```log
================================================================================
2026-07-25T19:20:31.223Z Session Start: beaconSeries
================================================================================
[2026-07-25T19:20:31.244Z] [INFO] Starting beaconSeries.js
[2026-07-25T19:20:31.750Z] [INFO] Found 20 series in Google Sheet 'seriesIndex'.
[2026-07-25T19:20:32.191Z] [ERROR] Error scraping series: Connection failed
Stack Trace:
Error: Connection failed
  at executeScript (/path/to/project/beaconSeries.js:98:15)
```

### Logging system features

- **Timestamping**: all entries include ISO 8601 timestamps
- **Session markers**: each script run is clearly delimited in the log file
- **Console mirroring**: all logs are output to console with appropriate coloring
- **Error tracing**: error logs automatically include stack traces when available
- **Summary statistics**: scripts track and report processed/skipped/error counts
- **Auto-configuration**: creates `logs/` directory if missing
- **Parameter validation**: all log methods validate input parameters

### Using the logger in a script

```javascript
const logger = require('./logger')('scriptName');
logger.info('Starting scriptName.js');
logger.warn('Something looked wrong but is recoverable');
logger.error('Something failed', error.message);
logger.summary(processedCount, skippedCount, errorCount);
```

### Log management

Files are rotated automatically once they exceed the size limit. Rotation keeps a
numbered set of old files per script and deletes files past the retention window.

```bash
npm run log-stats      # View log statistics
npm run log-rotate     # Rotate large log files
npm run log-cleanup    # Delete log files past the retention window
npm run log-maintain   # Rotate + cleanup + compress
npm run clear-logs     # Empty all log files
```

The same operations are available as buttons in the web interface.

### Log configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `MAX_LOG_SIZE_MB` | `10` | Size in MB a file must exceed to be rotated |
| `MAX_LOG_FILES` | `5` | Number of rotated files kept per script |
| `LOG_RETENTION_DAYS` | `30` | Age in days after which rotated files are deleted |
| `COMPRESS_LOGS` | unset | Set to `true` to gzip rotated logs. Skipped on Windows |

## Updating or Resetting Data

- **Re-scrape all runtimes**: run `findRuntimes.js` and answer `Y` at the prompt.
- **Rebuild a series**: `beaconSeries.js` already replaces the rows for every tag in
  `seriesIndex` on each run, so simply rerun it.
- **Drop a series entirely**: delete its row from `seriesIndex` *and* its rows from
  `series`. Removing the `seriesIndex` row alone leaves the `series` rows in place by
  design, so unrelated history is not lost.
- **Rebuild the calendar**: run `updateGCal.js`, which deletes and recreates all
  upcoming events.

## Troubleshooting

### Website structure dependencies

The Beacon's site is an Astro build with no schema.org microdata, so scraping depends
entirely on CSS classes. If a script starts reporting zero results, check these first:

| Script | Depends on | Notes |
| --- | --- | --- |
| discoverSeries.js | `.listing-section`, `.section-heading-brush`, `a.card`, `.card-title` | Section headings are matched against `/now playing/i` to decide what is still running. |
| beaconSeries.js | `.film-list .film-title`, falling back to `h1.movie-title` | Scope to `.film-title`; a broad `h1, h2, h3` query also captures the page heading and the "Films in this Program" label. The fallback covers a `seriesIndex` row pointing at a single film page. |
| beaconSchedule.js | `.cal-list .cal-list-day`, `.cal-list-date`, `.cal-list-entry`, `a.cal-list-movie`, `.cal-list-time` | Every showtime is rendered **twice** (desktop `.cal-grid` and mobile `.cal-list`); scraping both doubles every event. Rentals are identified by the `cal-list-entry-rental` class, not by title, because title casing differs between the two views. |
| findRuntimes.js | `.meta-field` pairing `.meta-label` with `.meta-value` | Runtime is rendered as e.g. `111 minutes`. |

The calendar carries **no year and no ISO datetime**. Day headings read
`"Saturday, July 25"` and times read `"7:00 PM"`, so `parseCalendarDate()` and
`parseTime12h()` in `utils.js` rebuild `YYYY-MM-DD` and `HH:MM`. The year is inferred
from the current date and validated against the weekday in the label, which is what
keeps a December-to-January render from landing a year early.

Series and program pages moved out of `/programs/entry/`, which now only serves a 308
redirect. `beaconSeries.js` rewrites those URLs automatically and logs a warning; update
`seriesURL` in the `seriesIndex` tab to `/programs/<slug>` to silence it. Rows added by
`discoverSeries.js` use current paths, so this only affects rows predating the move.

A film with no series is expected to have an empty `SeriesTag` — one-off screenings make
up most of any given month. Coverage only drops unexpectedly if `discoverSeries.js` stops
finding entries, so check its log first when tags go missing.

### Authentication issues

- **Credentials**: all 11 `GOOGLE_*` variables must be set, plus `SPREADSHEET_ID`.
  `sheetsUtils.js` checks them at startup and names whichever are missing. Credentials come
  from the environment; no service account JSON file is read at runtime.
- **Private key format**: `GOOGLE_PRIVATE_KEY` must contain `-----BEGIN PRIVATE KEY-----`.
- **Calendar ID**: verify `CALENDAR_ID` is set correctly in your `.env` file.
- **Calendar permissions**: the service account email must be an editor on your calendar.
- **Sheet permissions**: the service account email must be an editor on your sheet.
- **API access**: confirm the Calendar API and Sheets API are enabled for your project.

### Google Sheets issues

- **Missing tabs**: ensure the sheet has `seriesIndex`, `series`, `schedule` and
  `runtimes`, named exactly.
- **Missing or renamed columns**: headers are matched by name. A renamed header reads as
  empty rather than failing loudly.
- **Wrong sheet**: check `SPREADSHEET_ID`. There is no default, so an unset value stops the
  scripts with a clear message rather than silently using another sheet. A `404` from the
  Sheets API usually means the ID is wrong; a `403` means the service account is not an
  editor on it.
- **Permission errors**: verify the service account email is an editor on the sheet.

### File and directory issues

- **Missing directories**: the `logs` directory is created automatically.
- **Permission errors**: ensure the scripts can read and write the project directory.

### Runtime issues

- **Node.js version**: Node 20.x or 22.x is required — see [Requirements](#requirements).
  `fullUpdate.js` checks the lower bound and exits early.
- **`Cannot read properties of undefined (reading 'prototype')` from
  `buffer-equal-constant-time`**, with `jwa` in the stack trace, means **Node 24 or newer**.
  That package reads `require('buffer').SlowBuffer`, which Node 24 removed, and
  `googleapis` still reaches it via `google-auth-library → jws → jwa`. It fails at
  `require` time, so the first script to touch Google auth dies before doing any work.

  Upgrading dependencies does **not** fix this: `buffer-equal-constant-time` has only ever
  published 1.0.0 and 1.0.1, and even the newest `google-auth-library` still depends on
  `jws → jwa → buffer-equal-constant-time`. Pin the runtime instead — `.node-version` sets
  22. On Render, check that no `NODE_VERSION` environment variable is overriding it.
- **Puppeteer/Chromium**: if Puppeteer fails to launch, install the missing system
  dependencies — see [PUPPETEER_RENDER_SETUP.md](PUPPETEER_RENDER_SETUP.md) — or run
  `node testPuppeteer.js` to check the setup.
- **Network timeouts**: `navigateWithRetry()` in `utils.js` retries twice before failing.

## License

GNU General Public License v3.0

// sheetsUtils.js
// Utility for reading/writing Google Sheets as CSV replacement
// Uses service account credentials from .env (not beacon-calendar-update.json)

const { google } = require('googleapis');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Validate required .env variables for service account
function validateEnvVars() {
  const requiredVars = [
    'GOOGLE_TYPE',
    'GOOGLE_PROJECT_ID',
    'GOOGLE_PRIVATE_KEY_ID',
    'GOOGLE_PRIVATE_KEY',
    'GOOGLE_CLIENT_EMAIL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_AUTH_URI',
    'GOOGLE_TOKEN_URI',
    'GOOGLE_AUTH_PROVIDER_X509_CERT_URL',
    'GOOGLE_CLIENT_X509_CERT_URL',
    'GOOGLE_UNIVERSE_DOMAIN',
  ];
  const missing = requiredVars.filter(v => !process.env[v] || process.env[v].trim() === '');
  if (missing.length > 0) {
    throw new Error(`Missing required .env variables for Google service account: ${missing.join(', ')}`);
  }
  // Private key format check
  if (!process.env.GOOGLE_PRIVATE_KEY.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('GOOGLE_PRIVATE_KEY in .env is missing BEGIN PRIVATE KEY header or is not properly formatted.');
  }
  // Checked separately from the service account block: this identifies which sheet to
  // use, not who is using it, so a missing value deserves its own message. There is no
  // default — pointing at some other sheet on a typo is worse than refusing to start.
  if (!process.env.SPREADSHEET_ID || process.env.SPREADSHEET_ID.trim() === '') {
    throw new Error(
      'SPREADSHEET_ID is not set. Take it from your Google Sheet URL, the part between ' +
      '/d/ and /edit, and set it in .env (or in the Render dashboard).'
    );
  }
}

validateEnvVars();

// Read only after validation, so this is never undefined. Trimmed because a trailing
// space survives a copy-paste into .env and would otherwise surface as a puzzling 404
// from the Sheets API rather than as a configuration problem.
const SPREADSHEET_ID = process.env.SPREADSHEET_ID.trim();

// Load service account credentials from environment variables
const credentials = {
  type: process.env.GOOGLE_TYPE,
  project_id: process.env.GOOGLE_PROJECT_ID,
  private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
  private_key: process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  client_id: process.env.GOOGLE_CLIENT_ID,
  auth_uri: process.env.GOOGLE_AUTH_URI,
  token_uri: process.env.GOOGLE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
  universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN,
};

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
}

async function getSheetRows(sheetName) {
  try {
    const auth = await getAuth().getClient();
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetName,
    });
    return res.data.values || [];
  } catch (err) {
    console.error(`[sheetsUtils] Error reading sheet '${sheetName}':`, err.message);
    throw err;
  }
}

// Replaces a sheet's contents with `rows`.
//
// values.update only overwrites the cells the new data covers, so writing fewer
// rows than the sheet already holds silently leaves the surplus behind. That is how
// stale screenings and mis-scraped titles accumulated. The surplus is cleared after
// the new values land, never before, so a failure mid-write cannot empty the sheet.
async function setSheetRows(sheetName, rows) {
  if (!sheetName || typeof sheetName !== 'string') {
    throw new Error('setSheetRows: sheetName must be a non-empty string');
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('setSheetRows: rows must be a non-empty array');
  }

  try {
    const auth = await getAuth().getClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const before = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetName,
    });
    const previousRowCount = (before.data.values || []).length;

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetName,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });

    if (previousRowCount > rows.length) {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A${rows.length + 1}:ZZ${previousRowCount}`,
      });
      console.log(`[sheetsUtils] '${sheetName}': wrote ${rows.length} rows, cleared ${previousRowCount - rows.length} surplus.`);
    }
  } catch (err) {
    console.error(`[sheetsUtils] Error writing to sheet '${sheetName}':`, err.message);
    throw err;
  }
}

module.exports = {
  getSheetRows,
  setSheetRows,
  SPREADSHEET_ID,
};

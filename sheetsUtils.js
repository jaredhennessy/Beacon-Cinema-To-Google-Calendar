// sheetsUtils.js
// Utility for reading/writing Google Sheets as CSV replacement
// Uses service account credentials from .env (not beacon-calendar-update.json)

const { google } = require('googleapis');
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1u10KqtqaDG3LhVAgSY5HCrepjQ_ePUGgeWjSuVCxXyE';

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
}

validateEnvVars();

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

async function setSheetRows(sheetName, rows) {
  try {
    const auth = await getAuth().getClient();
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetName,
      valueInputOption: 'RAW',
      requestBody: { values: rows },
    });
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

// sheetsUtils.js
// Utility for reading/writing Google Sheets as CSV replacement

const { google } = require('googleapis');
const path = require('path');
const credentials = require(path.join(__dirname, 'beacon-calendar-update.json'));
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SPREADSHEET_ID = '1u10KqtqaDG3LhVAgSY5HCrepjQ_ePUGgeWjSuVCxXyE';

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
}

async function getSheetRows(sheetName) {
  const auth = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
  });
  return res.data.values || [];
}

async function setSheetRows(sheetName, rows) {
  const auth = await getAuth().getClient();
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}

module.exports = {
  getSheetRows,
  setSheetRows,
  SPREADSHEET_ID,
};

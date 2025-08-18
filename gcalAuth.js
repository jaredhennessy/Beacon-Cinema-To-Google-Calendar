/**
 * gcalAuth.js
 * Handles Google service account authentication for Google Calendar API.
 * Exports getServiceAccountClient().
 * Usage: require('./gcalAuth').getServiceAccountClient()
 * - Not intended to be run directly.
 * - Always outputs troubleshooting steps on authentication errors.
 * Environment variable required: CALENDAR_ID
 * beacon-calendar-update.json (service account key) must be present in the project root.
 *
 * Note: This project now uses a Google service account for all authentication. token.json and OAuth2 are no longer used.
 */

const fs = require('fs');
const { google } = require('googleapis');

const SERVICE_ACCOUNT_PATH = 'beacon-calendar-update.json';

// Print common troubleshooting steps for authentication issues (service account)
function printAuthTroubleshooting() {
    console.log('[TROUBLESHOOT] Common authentication issues:');
    console.log('  - Ensure beacon-calendar-update.json (service account key) is present and valid in the project root.');
    console.log('  - CALENDAR_ID must be set in your .env file.');
    console.log('  - Make sure your Google Cloud project has the Calendar API enabled.');
    console.log('  - The service account email must be added as an editor to your target Google Calendar (in the Google Calendar UI).');
    console.log('  - If you see a permissions error, double-check calendar sharing and the service account email.');
    console.log('  - OAuth2 and token.json are no longer used.');
}

process.on('unhandledRejection', (reason) => {
    console.error('[ERROR] Unhandled promise rejection in gcalAuth.js:', reason);
    printAuthTroubleshooting();
    process.exit(1);
});

if (require.main === module) {
    console.error('[ERROR] gcalAuth.js is a library and should not be run directly.');
    process.exit(1);
}

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Returns an authenticated Google client using a service account
function getServiceAccountClient() {
    const keyFile = SERVICE_ACCOUNT_PATH;
    if (!fs.existsSync(keyFile)) {
        throw new Error(`[ERROR] Service account file not found: ${keyFile}`);
    }
    const credentials = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
    const client = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: SCOPES,
    });
    return client;
}

module.exports = { getServiceAccountClient };

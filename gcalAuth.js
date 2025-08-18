/**
 * gcalAuth.js
 * Handles Google service account authentication for Google Calendar API.
 * Exports getServiceAccountClient().
 * Usage: require('./gcalAuth').getServiceAccountClient()
 * - Not intended to be run directly.
 * - Always outputs troubleshooting steps on authentication errors.
 * Environment variable required: CALENDAR_ID
 * beacon-calendar-update.json must be present in the project root.
 */

const fs = require('fs');
const { google } = require('googleapis');

const SERVICE_ACCOUNT_PATH = 'beacon-calendar-update.json';

// Print common troubleshooting steps for authentication issues
function printAuthTroubleshooting() {
    console.log('[TROUBLESHOOT] Common authentication issues:');
    console.log('  - Ensure credentials.json is present and valid (download from Google Cloud Console).');
    console.log('  - CALENDAR_ID must be set in your .env file.');
    console.log('  - If you see "redirect_uri_mismatch", update your Google Cloud Console OAuth2 redirect URI.');
    console.log('  - If you see "invalid_grant", the authorization code may have expired. Try authorizing again.');
    console.log('  - If you see "invalid_request", check your credentials.json and .env for typos.');
    console.log('  - Make sure your Google Cloud project has the Calendar API enabled.');
    console.log('  - Delete token.json and re-run the script to reauthorize if token issues persist.');
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

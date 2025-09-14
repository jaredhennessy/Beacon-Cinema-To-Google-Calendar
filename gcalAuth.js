/**
 * gcalAuth.js
 * Handles Google service account authentication for Google Calendar API.
 * Exports getServiceAccountClient() which returns a JWT client for Google Calendar API.
 * 
 * @typedef {import('./types').ServiceAccountConfig} ServiceAccountConfig
 * @typedef {import('./types').EnvironmentConfig} EnvironmentConfig
 * 
 * Usage: const client = require('./gcalAuth').getServiceAccountClient()
 * 
 * Required environment variables:
 * - Service account credentials (see .env)
 * - CALENDAR_ID must be set in .env file and shared with service account
 * 
 * Common authentication issues:
 * - Ensure all required service account variables are set in .env
 * - CALENDAR_ID must be set in your .env file
 * - Google Cloud project must have Calendar API enabled
 * - Service account email must be added as editor to calendar in Google Calendar UI
 * - Check calendar sharing and service account email for permissions errors
 * - OAuth2 and token.json are not used, only service account authentication
 */

require('dotenv').config();

// External dependencies
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Library-only module
if (require.main === module) {
    throw new Error('gcalAuth.js is a library and should not be run directly.');
}

/**
 * Returns an authenticated Google client using a service account.
 * Validates service account configuration and provides detailed error messages.
 * @returns {google.auth.JWT} Authenticated JWT client for Google Calendar API
 * @throws {Error} If service account file is missing or invalid, with troubleshooting info
 */
function getServiceAccountClient() {
    // Load credentials from environment variables
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY;

    if (!clientEmail || !privateKey) {
        throw new Error(
            'Missing Google service account credentials in environment variables.\n\n' +
            'Troubleshooting:\n' +
            '- Set GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY in your .env file or Render environment.\n' +
            '- Download a new key from Google Cloud Console if needed.\n' +
            '- Ensure the service account has Calendar API access.'
        );
    }
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        throw new Error('GOOGLE_PRIVATE_KEY in .env is missing BEGIN PRIVATE KEY header or is not properly formatted.');
    }

    // Create and return JWT client
    const client = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: SCOPES,
    });
    return client;
}

module.exports = { getServiceAccountClient };

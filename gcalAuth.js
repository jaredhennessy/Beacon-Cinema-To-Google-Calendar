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
 * Required files/env:
 * - beacon-calendar-update.json (service account key) must be in project root
 * - CALENDAR_ID must be set in .env file and shared with service account
 * 
 * Common authentication issues:
 * - Ensure beacon-calendar-update.json (service account key) is present and valid
 * - CALENDAR_ID must be set in your .env file
 * - Google Cloud project must have Calendar API enabled
 * - Service account email must be added as editor to calendar in Google Calendar UI
 * - Check calendar sharing and service account email for permissions errors
 * - OAuth2 and token.json are not used, only service account authentication
 */

// External dependencies
const fs = require('fs');
const { google } = require('googleapis');

const SERVICE_ACCOUNT_PATH = 'beacon-calendar-update.json';
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
    const keyFile = SERVICE_ACCOUNT_PATH;
    
    // Check if service account file exists
    if (!fs.existsSync(keyFile)) {
        throw new Error(
            `Service account file not found: ${keyFile}\n\n` +
            'Troubleshooting:\n' +
            '- Ensure beacon-calendar-update.json is in the project root\n' +
            '- Download a new key from Google Cloud Console if needed\n' +
            '- Check file permissions'
        );
    }

    try {
        // Parse and validate service account credentials
        const credentials = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
        
        if (!credentials.client_email || !credentials.private_key) {
            throw new Error(
                'Invalid service account credentials - missing required fields\n\n' +
                'Troubleshooting:\n' +
                '- Download a new key from Google Cloud Console\n' +
                '- Ensure the service account has Calendar API access\n' +
                '- Required fields: client_email, private_key'
            );
        }

        // Create and return JWT client
        const client = new google.auth.JWT({
            email: credentials.client_email,
            key: credentials.private_key,
            scopes: SCOPES,
        });
        
        return client;
    } catch (error) {
        // Enhance error message if it's a JSON syntax error
        if (error.name === 'SyntaxError') {
            throw new Error(
                'Invalid service account file format - not valid JSON\n\n' +
                'Troubleshooting:\n' +
                '- Download a new key from Google Cloud Console\n' +
                '- Do not modify the JSON file manually\n' +
                '- Ensure the file is not corrupted'
            );
        }
        // Re-throw other errors with their original message
        throw error;
    }
}

module.exports = { getServiceAccountClient };

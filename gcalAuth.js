/**
 * gcalAuth.js
 * Handles Google OAuth2 authorization for Google Calendar API.
 * Exports getAccessToken(oAuth2Client).
 * Usage: require('./gcalAuth').getAccessToken(oAuth2Client)
 * - Not intended to be run directly.
 * - Always outputs troubleshooting steps on authentication errors.
 * Environment variables required: OAUTH2_REDIRECT_URI, CALENDAR_ID
 * credentials.json must have a "web" property with client_id and client_secret.
 */

const fs = require('fs');
const http = require('http');
const url = require('url');

const LOCAL_SERVER_PORT = 3000; // Port for OAuth2 redirect

// Print common troubleshooting steps for authentication issues
function printAuthTroubleshooting() {
    console.log('[TROUBLESHOOT] Common authentication issues:');
    console.log('  - Ensure credentials.json is present and valid (download from Google Cloud Console).');
    console.log('  - OAUTH2_REDIRECT_URI and CALENDAR_ID must be set in your .env file.');
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
const TOKEN_PATH = 'token.json';

// Main function to get access token, or reuse existing token if valid
// Returns a Promise that resolves when token is available or stored
async function getAccessToken(oAuth2Client) {
    try {
        // Check credentials.json existence and structure
        if (!fs.existsSync('credentials.json')) {
            console.error('[ERROR] credentials.json file is missing.');
            printAuthTroubleshooting();
            process.exit(1);
        }
        try {
            const credentials = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
            if (!credentials.web || !credentials.web.client_id || !credentials.web.client_secret) {
                console.error('[ERROR] credentials.json is missing client_id or client_secret.');
                printAuthTroubleshooting();
                process.exit(1);
            }
        } catch (e) {
            console.error('[ERROR] Unable to parse credentials.json.');
            printAuthTroubleshooting();
            process.exit(1);
        }
        // Check required environment variables
        if (!process.env.OAUTH2_REDIRECT_URI || !process.env.CALENDAR_ID) {
            console.error('[ERROR] OAUTH2_REDIRECT_URI and CALENDAR_ID must be set in your .env file.');
            printAuthTroubleshooting();
            process.exit(1);
        }
        // If token exists and is valid, reuse it
        if (fs.existsSync(TOKEN_PATH)) {
            try {
                const token = fs.readFileSync(TOKEN_PATH, 'utf8');
                if (!token.trim() || !token.trim().startsWith('{')) {
                    console.error('[ERROR] token.json is empty or malformed.');
                    printAuthTroubleshooting();
                    process.exit(1);
                }
                const parsed = JSON.parse(token);
                if (parsed.expiry_date && parsed.expiry_date < Date.now()) {
                    console.warn('[WARN] token.json is expired. Delete token.json and re-run the script to reauthorize.');
                }
                console.log('[INFO] Existing token.json found. Reusing stored token.');
                return;
            } catch (err) {
                console.error('[ERROR] token.json is malformed. Please delete and reauthorize.');
                printAuthTroubleshooting();
                process.exit(1);
            }
        }
        // Start OAuth2 flow if no valid token
        const authUrl = oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
        });
        console.log('[INFO] Authorize this app by visiting this URL:', authUrl);
        return new Promise((resolve, reject) => {
            let serverClosed = false;
            const server = http.createServer(async (req, res) => {
                try {
                    if (req.method === 'GET' && url.parse(req.url).pathname === '/') {
                        const query = new url.URL(req.url, `http://localhost:${LOCAL_SERVER_PORT}`).searchParams;
                        const code = query.get('code');
                        if (code) {
                            res.end('Authorization successful! You can close this window.');
                            try {
                                const { tokens } = await oAuth2Client.getToken(code);
                                oAuth2Client.setCredentials(tokens);
                                fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
                                console.log('[INFO] Token stored to', TOKEN_PATH);
                                console.log('[INFO] Authorization complete.');
                                if (!serverClosed) {
                                    serverClosed = true;
                                    // Remove event listeners and clean up server
                                    server.removeAllListeners();
                                    clearTimeout(timeout);
                                    server.close(() => {
                                        console.log('[INFO] Server closed.');
                                        resolve();
                                    });
                                }
                            } catch (err) {
                                console.error('[ERROR] Error retrieving access token:', err.message);
                                res.end('Error retrieving access token. Check the console for details.');
                                printAuthTroubleshooting(); // Display troubleshooting steps for other issues
                                reject(err);
                            }
                        } else {
                            res.end('Authorization failed. No authorization code received.');
                            console.error('[ERROR] No authorization code received in callback.');
                            printAuthTroubleshooting(); // Display troubleshooting steps for other issues
                            reject(new Error('No authorization code received.'));
                        }
                    } else {
                        res.statusCode = 404;
                        res.end('Not found');
                    }
                } catch (err) {
                    console.error('[ERROR] Unexpected error in OAuth2 callback:', err);
                    res.statusCode = 500;
                    res.end('Internal server error');
                    printAuthTroubleshooting(); // Display troubleshooting steps for other issues
                    reject(err);
                } finally {
                    if (!serverClosed) {
                        serverClosed = true;
                        server.close(() => console.log('[INFO] Server closed.'));
                    }
                }
            });

            server.listen(LOCAL_SERVER_PORT, () => {
                console.log(`[INFO] Waiting for authorization on http://localhost:${LOCAL_SERVER_PORT}...`);
            }).on('error', (err) => {
                console.error('[ERROR] Server error:', err);
                reject(err);
            });

            // Timeout: close server after 5 minutes if no authorization
            const timeout = setTimeout(() => {
                if (!serverClosed) {
                    serverClosed = true;
                    console.error('[ERROR] Authorization timed out after 5 minutes.');
                    server.close(() => reject(new Error('Authorization timed out.')));
                }
            }, 5 * 60 * 1000);

            // Graceful shutdown on SIGINT
            process.on('SIGINT', () => {
                console.log('[INFO] Shutting down the server...');
                if (!serverClosed) {
                    serverClosed = true;
                    clearTimeout(timeout);
                    server.close(() => {
                        console.log('[INFO] Server closed.');
                    });
                }
            });
        });
    } catch (err) {
        console.error('[ERROR] Unexpected error during OAuth2 authorization:', err);
        printAuthTroubleshooting();
        process.exit(1);
    }
}

module.exports = { getAccessToken };

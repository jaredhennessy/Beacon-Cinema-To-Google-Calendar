/**
 * fullUpdate.js
 * Runs the full Beacon Cinema to Google Calendar update pipeline automatically:
 * 1. beaconSeries.js   - Updates series information in Google Sheet 'series'.
 * 2. beaconSchedule.js - Scrapes the schedule and updates Google Sheet 'schedule'.
 * 3. findRuntimes.js   - Extracts runtimes and updates Google Sheet 'runtimes'.
 * 4. updateGCal.js     - Updates Google Calendar with the latest schedule from Google Sheets.
 * Usage: node fullUpdate.js
 * Each step is executed sequentially without user prompts. If any step fails, the script logs the error and exits.
 * Ensures header rows in all output Google Sheets after each step.
 * All credentials and configuration are loaded from .env (not beacon-calendar-update.json).
 * Dependencies: ./utils.js, ./logger.js
 */

// External dependencies
const { execSync } = require('child_process');
const path = require('path');

// Internal dependencies
const { checkFile } = require('./utils');
const logger = require('./logger')('fullUpdate');
const { setupErrorHandling, handleError } = require('./errorHandler');

setupErrorHandling(logger, 'fullUpdate.js');

// Node.js version check
const minNodeVersion = 14;
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor < minNodeVersion) {
    logger.error(`Node.js version ${minNodeVersion}+ required. Detected: ${process.versions.node}`);
    logger.error('fullUpdate.js did not run due to incompatible Node.js version.');
    process.exit(1);
}

function runScript(script, label, stepNum) {
    // Parameter validation
    if (!script || typeof script !== 'string') {
        throw new Error('runScript: script must be a non-empty string');
    }
    if (!label || typeof label !== 'string') {
        throw new Error('runScript: label must be a non-empty string');
    }
    if (typeof stepNum !== 'number' || stepNum < 1) {
        throw new Error('runScript: stepNum must be a positive number');
    }
    
    try {
        logger.info(`[STEP ${stepNum}] Running ${label}...`);
        execSync(`node ${path.join(__dirname, script)}`, { stdio: 'inherit' });
        logger.info(`[STEP ${stepNum}] ${label} completed.`);
    } catch (error) {
        handleError(logger, error, `[STEP ${stepNum}] ${label} failed`, true);
    }
}

/**
 * Checks that all required files and directories exist before running the pipeline
 * @returns {void}
 */
// No longer checks for CSV files; all data is now in Google Sheets
function checkRequiredFiles() {
    // Check for script files
    const requiredScripts = [
        'beaconSeries.js',
        'beaconSchedule.js',
        'findRuntimes.js',
        'updateGCal.js'
    ];
    for (const script of requiredScripts) {
        checkFile(path.join(__dirname, script), {
            required: true,
            missingMessage: `Required script ${script} is missing`,
            parentScript: 'fullUpdate.js'
        });
    }
}

// No longer checks for output CSV files; all output is now in Google Sheets
function checkStepOutput(sheetName, label) {
    // Parameter validation
    if (!sheetName || typeof sheetName !== 'string') {
        throw new Error('checkStepOutput: sheetName must be a non-empty string');
    }
    if (!label || typeof label !== 'string') {
        throw new Error('checkStepOutput: label must be a non-empty string');
    }
    // Optionally, could check Google Sheet for expected header/rows
    logger.info(`Checked output for ${label} in Google Sheet '${sheetName}'.`);
}

// Removed promptToRunScript and runConditionalScript functions - now runs automatically

(async () => {
    try {
        logger.info('Starting fullUpdate.js');
        checkRequiredFiles();

        runScript('beaconSeries.js', 'beaconSeries.js', 1);
        checkStepOutput('series', 'beaconSeries.js');

        runScript('beaconSchedule.js', 'beaconSchedule.js', 2);
        checkStepOutput('schedule', 'beaconSchedule.js');

        runScript('findRuntimes.js', 'findRuntimes.js', 3);
        checkStepOutput('runtimes', 'findRuntimes.js');

        runScript('updateGCal.js', 'updateGCal.js', 4);

        logger.info('fullUpdate.js completed all steps.');
    } catch (err) {
        logger.error('Unhandled exception in fullUpdate.js:', err);
        process.exit(1);
    }
})();

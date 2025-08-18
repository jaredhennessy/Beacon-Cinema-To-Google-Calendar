/**
 * fullUpdate.js
 * Runs the full Beacon Cinema to Google Calendar update pipeline:
 * 1. beaconSeries.js   - Updates series information and files/series.csv.
 * 2. beaconSchedule.js - Scrapes the schedule and updates files/schedule.csv.
 * 3. findRuntimes.js   - Extracts runtimes and updates files/runtimes.csv.
 * 4. updateGCal.js     - Updates Google Calendar with the latest schedule.
 * Usage: node fullUpdate.js
 * Each step is executed sequentially. If any step fails, the script logs the error and exits.
 * Ensures header rows in all output CSVs after each step.
 * Dependencies: ./utils.js, ./logger.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { ensureHeader, warnIfDuplicateRows } = require('./utils');
const logger = require('./logger')('fullUpdate');

// Global unhandled rejection handler
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection:', reason);
    logger.error('fullUpdate.js failed due to an unhandled exception.');
    process.exit(1);
});

// Node.js version check
const minNodeVersion = 14;
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor < minNodeVersion) {
    logger.error(`Node.js version ${minNodeVersion}+ required. Detected: ${process.versions.node}`);
    logger.error('fullUpdate.js did not run due to incompatible Node.js version.');
    process.exit(1);
}

function runScript(script, label, stepNum) {
    try {
        logger.info(`[STEP ${stepNum}] Running ${label}...`);
        execSync(`node ${path.join(__dirname, script)}`, { stdio: 'inherit' });
        logger.info(`[STEP ${stepNum}] ${label} completed.`);
    } catch (error) {
        logger.error(`[STEP ${stepNum}] ${label} failed:`, error.message);
        logger.error(`fullUpdate.js stopped at step ${stepNum}. Please check the logs for ${label}.`);
        process.exit(1);
    }
}

// Ensure required files and directories exist before running pipeline
function checkRequiredFiles() {
    const required = [
        'beaconSeries.js',
        'beaconSchedule.js',
        'findRuntimes.js',
        'updateGCal.js',
        'files/seriesIndex.csv',
        'files/series.csv'
    ];
    // Ensure files directory exists
    const filesDir = path.join(__dirname, 'files');
    if (!fs.existsSync(filesDir)) {
        logger.error('Required directory missing: files/');
        logger.error('fullUpdate.js did not run due to missing files directory.');
        process.exit(1);
    }
    for (const file of required) {
        const filePath = path.join(__dirname, file);
        if (!fs.existsSync(filePath)) {
            // Special handling for series.csv: create with header if missing
            if (file.endsWith('series.csv')) {
                const expectedHeader = 'Title,SeriesTag,DateRecorded';
                fs.writeFileSync(filePath, expectedHeader + '\n');
                logger.warn(`${file} was missing. Created with header row.`);
                continue;
            }
            logger.error(`Required file missing: ${file}`);
            logger.error('fullUpdate.js did not run due to missing file.');
            process.exit(1);
        }
        // Check for required CSV headers
        if (file.endsWith('.csv')) {
            let expectedHeader = '';
            if (file.endsWith('seriesIndex.csv')) expectedHeader = 'seriesName,seriesURL,seriesTag';
            if (file.endsWith('series.csv')) expectedHeader = 'Title,SeriesTag,DateRecorded';
            if (expectedHeader) ensureHeader(filePath, expectedHeader);
        }
    }
}

function checkStepOutput(file, label) {
    const filePath = path.join(__dirname, file);
    if (!fs.existsSync(filePath)) {
        logger.error(`Expected output file missing after ${label}: ${file}`);
        logger.error(`fullUpdate.js stopped after ${label} due to missing output file.`);
        process.exit(1);
    }
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) {
        logger.error(`Output file ${file} is empty after ${label}.`);
        logger.warn(`Output file ${file} is empty after ${label}.`);
        process.exit(1);
    }
    const firstLine = content.split('\n')[0];
    let expectedHeader = '';
    if (file.endsWith('schedule.csv')) expectedHeader = 'Title,Date,Time,URL,SeriesTag,DateRecorded';
    if (file.endsWith('runtimes.csv')) expectedHeader = 'Title,Runtime';
    if (expectedHeader && firstLine.replace(/\s/g, '').toLowerCase() !== expectedHeader.replace(/\s/g, '').toLowerCase()) {
        fs.writeFileSync(filePath, expectedHeader + '\n' + content);
        logger.warn(`Output file ${file} was missing a proper header row after ${label}. Header inserted.`);
    }
    warnIfDuplicateRows(filePath);
    // Warn if no valid records written (only header present)
    const lines = content.split('\n');
    if (lines.length <= 1) {
        logger.warn(`No valid records written to ${file} after ${label}.`);
        logger.info(`No valid records written to ${file} after ${label}.`);
    }
}

async function promptToRunScript(scriptName) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        const timeout = setTimeout(() => {
            logger.info(`No input received. Proceeding with ${scriptName}.`);
            rl.close();
            resolve(true);
        }, 5000);
        rl.question(`Do you want to run ${scriptName}? (Y/N): `, (answer) => {
            clearTimeout(timeout);
            rl.close();
            resolve(answer.trim().toUpperCase() === 'Y');
        });
    });
}

async function runConditionalScript(script, label, stepNum) {
        const shouldRun = await promptToRunScript(label);
        if (shouldRun) {
            runScript(script, label, stepNum);
        } else {
            logger.info(`Skipping ${label} as per user input.`);
        }
    }

(async () => {
    try {
        logger.info('[START] fullUpdate.js');
        checkRequiredFiles();

        await runConditionalScript('beaconSeries.js', 'beaconSeries.js', 1);
        checkStepOutput('files/series.csv', 'beaconSeries.js');

        await runConditionalScript('beaconSchedule.js', 'beaconSchedule.js', 2);
        checkStepOutput('files/schedule.csv', 'beaconSchedule.js');

                await runConditionalScript('findRuntimes.js', 'findRuntimes.js', 3);
        checkStepOutput('files/runtimes.csv', 'findRuntimes.js');

        await runConditionalScript('updateGCal.js', 'updateGCal.js', 4);

        logger.info('[COMPLETE] All steps finished successfully.');
        logger.info('[SUMMARY] fullUpdate.js completed all steps.');
    } catch (err) {
        logger.error('[ERROR] Unhandled exception in fullUpdate.js:', err);
        logger.error('[SUMMARY] fullUpdate.js failed due to an unhandled exception.');
        process.exit(1);
    }
})();

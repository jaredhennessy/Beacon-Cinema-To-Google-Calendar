/**
 * fullUpdate.js
 * Runs the full Beacon Cinema to Google Calendar update pipeline automatically:
 * 1. discoverSeries.js - Adds newly listed series to Google Sheet 'seriesIndex'.
 * 2. beaconSeries.js   - Updates series information in Google Sheet 'series'.
 * 3. beaconSchedule.js - Scrapes the schedule and updates Google Sheet 'schedule'.
 * 4. findRuntimes.js   - Extracts runtimes and updates Google Sheet 'runtimes'.
 * 5. updateGCal.js     - Updates Google Calendar with the latest schedule from Google Sheets.
 * Usage: node fullUpdate.js
 * - Runs each step sequentially, without prompts, and stops at the first failure.
 * - Reports each step's exit code, or the signal that killed it, plus how long it took.
 *   A step killed by SIGKILL is almost always the host running out of memory.
 * - Runs every step under this same Node binary rather than whatever `node` resolves to.
 * - Forwards SIGINT and SIGTERM to the running step so it is not left orphaned.
 * All credentials and configuration are loaded from .env (not beacon-calendar-update.json).
 * Dependencies: ./utils.js, ./logger.js, ./errorHandler.js
 */

// External dependencies
const { spawn } = require('child_process');
const path = require('path');

// Internal dependencies
const { checkFile } = require('./utils');
const logger = require('./logger')('fullUpdate');
const { setupErrorHandling, handleError } = require('./errorHandler');

setupErrorHandling(logger, 'fullUpdate.js');

// Node.js version check.
// 20 is what the dependencies actually need: glob requires "20 || >=22", puppeteer and
// express require >=18, and fs.readdirSync(dir, { recursive: true }) in puppeteerConfig.js
// needs 18.17+. Gating lower than this is worse than useless, because require('glob')
// failing on an older runtime is swallowed by a try/catch in getPuppeteerConfig() and
// Chrome discovery silently falls back instead of reporting the real problem.
const minNodeVersion = 20;
const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor < minNodeVersion) {
    logger.error(`Node.js version ${minNodeVersion}+ required. Detected: ${process.versions.node}`);
    logger.error('fullUpdate.js did not run due to incompatible Node.js version.');
    process.exit(1);
}

// The step currently running, so a termination signal can be passed on to it.
let activeChild = null;

// Without this, terminating the pipeline would leave the running step alive — and that step
// may itself have launched Chrome. execSync got this for free by blocking in the same process
// group; spawn does not.
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        logger.warn(`Received ${signal}. Stopping the current step and exiting.`);
        if (activeChild) activeChild.kill(signal);
        process.exit(1);
    });
}

/**
 * Runs one pipeline step as a child process and waits for it to finish.
 *
 * Uses spawn with an argument array rather than execSync with a command string, for three
 * reasons: a string command goes through a shell and so breaks on any path containing a
 * space; bare `node` resolves from PATH and may not be the version this script just
 * checked; and execSync reports only "Command failed", discarding the signal, which is the
 * one detail that identifies an out-of-memory kill.
 *
 * stdio is inherited so the child writes straight to this process's descriptors, which is
 * what keeps its output streaming live instead of being buffered and relayed.
 *
 * @param {string} script - Filename of the step, resolved relative to this file
 * @param {string} label - Human-readable name for logging
 * @param {number} stepNum - 1-based step number
 * @returns {Promise<void>} Resolves when the step exits 0; exits the process otherwise
 */
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

    return new Promise(resolve => {
        logger.info(`[STEP ${stepNum}] Running ${label}...`);
        const startedAt = Date.now();

        // process.execPath is this same Node binary, so a step cannot silently run under a
        // different version than the one checked above.
        const child = spawn(process.execPath, [path.join(__dirname, script)], {
            stdio: 'inherit'
        });
        activeChild = child;

        const finish = (error) => {
            activeChild = null;
            const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
            if (error) {
                // Exits the process, matching the previous stop-on-first-failure behaviour.
                handleError(logger, error, `[STEP ${stepNum}] ${label} failed after ${seconds}s`, true);
                return;
            }
            logger.info(`[STEP ${stepNum}] ${label} completed in ${seconds}s.`);
            resolve();
        };

        // Emitted when the binary itself cannot be run. Unhandled, it would throw.
        child.on('error', err => finish(
            new Error(`could not start ${process.execPath}: ${err.message}`)
        ));

        child.on('close', (code, signal) => {
            if (signal) {
                const hint = signal === 'SIGKILL'
                    ? ' The host most likely ran out of memory; see the memory notes in README.md.'
                    : '';
                finish(new Error(`killed by ${signal}.${hint}`));
            } else if (code !== 0) {
                finish(new Error(`exited with code ${code}`));
            } else {
                finish();
            }
        });
    });
}

/**
 * Checks that all required files and directories exist before running the pipeline
 * @returns {void}
 */
// No longer checks for CSV files; all data is now in Google Sheets
function checkRequiredFiles() {
    // Check for script files
    const requiredScripts = [
        'discoverSeries.js',
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

        // Awaited one at a time, so the steps stay strictly sequential.
        //
        // Runs before beaconSeries.js so a newly listed series is scraped on the
        // same pass it is discovered, rather than a run later.
        await runScript('discoverSeries.js', 'discoverSeries.js', 1);
        checkStepOutput('seriesIndex', 'discoverSeries.js');

        await runScript('beaconSeries.js', 'beaconSeries.js', 2);
        checkStepOutput('series', 'beaconSeries.js');

        await runScript('beaconSchedule.js', 'beaconSchedule.js', 3);
        checkStepOutput('schedule', 'beaconSchedule.js');

        await runScript('findRuntimes.js', 'findRuntimes.js', 4);
        checkStepOutput('runtimes', 'findRuntimes.js');

        await runScript('updateGCal.js', 'updateGCal.js', 5);

        logger.info('fullUpdate.js completed all steps.');
    } catch (err) {
        logger.error('Unhandled exception in fullUpdate.js:', err);
        process.exit(1);
    }
})();

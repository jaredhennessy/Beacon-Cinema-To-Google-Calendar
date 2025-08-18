/**
 * logger.js
 * Shared logging utility for all scripts.
 * Creates timestamped logs in the logs/ directory.
 * 
 * Usage:
 * const logger = require('./logger')('scriptName');
 * logger.info('Message');
 * logger.warn('Warning');
 * logger.error('Error');
 */

const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Log levels and their order
const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

class Logger {
    constructor(scriptName) {
        this.scriptName = scriptName;
        this.logFile = path.join(logsDir, `${scriptName}.log`);
        
        // Create or append to log file with session start marker
        const sessionStart = '\n' + '='.repeat(80) + '\n'
            + `${this.getTimestamp()} Session Start: ${scriptName}\n`
            + '='.repeat(80) + '\n';
        fs.appendFileSync(this.logFile, sessionStart);
    }

    getTimestamp() {
        const now = new Date();
        return now.toISOString();
    }

    log(level, message, error = null) {
        const timestamp = this.getTimestamp();
        let logMessage = `[${timestamp}] [${level}] ${message}`;
        
        // Add error details if present
        if (error) {
            if (error.stack) {
                logMessage += `\nStack Trace:\n${error.stack}`;
            } else {
                logMessage += `\nError: ${error.toString()}`;
            }
        }

        // Always append to file
        fs.appendFileSync(this.logFile, logMessage + '\n');

        // Also log to console with color if available
        const consoleMessage = `[${this.scriptName}] ${message}`;
        switch (level) {
            case 'ERROR':
                console.error(consoleMessage);
                break;
            case 'WARN':
                console.warn(consoleMessage);
                break;
            case 'INFO':
                console.log(consoleMessage);
                break;
            case 'DEBUG':
                console.debug(consoleMessage);
                break;
        }
    }

    error(message, error = null) {
        this.log('ERROR', message, error);
    }

    warn(message) {
        this.log('WARN', message);
    }

    info(message) {
        this.log('INFO', message);
    }

    debug(message) {
        this.log('DEBUG', message);
    }

    // Log a summary of script execution
    summary(processed, skipped, errors = 0) {
        const summaryMsg = `Summary - Processed: ${processed}, Skipped: ${skipped}, Errors: ${errors}`;
        this.info(summaryMsg);
        
        const sessionEnd = '='.repeat(80) + '\n'
            + `${this.getTimestamp()} Session End: ${this.scriptName}\n`
            + '='.repeat(80) + '\n';
        fs.appendFileSync(this.logFile, sessionEnd);
    }
}

// Factory function to create logger instances
module.exports = function(scriptName) {
    return new Logger(scriptName);
};

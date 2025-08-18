/**
 * logger.js - Centralized Logging System
 * 
 * Provides comprehensive logging functionality for all scripts in the
 * Beacon Cinema Calendar Sync project with file and console output.
 * 
 * Features:
 * - Multiple log levels (debug, info, warn, error)
 * - Automatic timestamping with ISO 8601 format
 * - Session markers for script execution tracking
 * - Console output with color coding
 * - Automatic error stack trace inclusion
 * - Summary statistics reporting
 * - Parameter validation for all log methods
 * - Auto-creation of logs directory
 * 
 * Usage:
 * const logger = require('./logger')('scriptName');
 * logger.debug('Debug message');     // Detailed debugging information
 * logger.info('Info message');       // General operational information
 * logger.warn('Warning message');    // Non-critical issues and warnings
 * logger.error('Error', errorObj);   // Critical errors with optional Error object
 * logger.summary(5, 2, 1);           // Execution summary (processed, skipped, errors)
 * 
 * Log Format: [ISO timestamp] [LEVEL] message
 * @author Beacon Cinema Calendar Sync Project
 * 
 * Each script run starts with a session marker for easy separation.
 */

// External dependencies
const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Log levels and their order
// @ts-check
/** @typedef {import('./types').Logger} LoggerInterface */

const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
};

/** @implements {LoggerInterface} */
class Logger {
    /**
     * @param {string} scriptName - Name of the script using this logger
     */
    constructor(scriptName) {
        // Parameter validation
        if (!scriptName || typeof scriptName !== 'string') {
            throw new Error('Logger constructor: scriptName must be a non-empty string');
        }
        
        /** @type {string} */
        this.scriptName = scriptName;
        /** @type {string} */
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

    /**
     * @param {string} level
     * @param {string} message
     * @param {Error | undefined} [error]
     */
    log(level, message, error) {
        // Parameter validation
        if (!level || typeof level !== 'string') {
            throw new Error('Logger.log: level must be a non-empty string');
        }
        if (!message || typeof message !== 'string') {
            throw new Error('Logger.log: message must be a non-empty string');
        }
        
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

    /**
     * @param {string} message
     * @param {Error} [error]
     */
    error(message, error) {
        this.log('ERROR', message, error);
    }

    /**
     * @param {string} message
     */
    warn(message) {
        this.log('WARN', message);
    }

    /**
     * @param {string} message
     */
    info(message) {
        this.log('INFO', message);
    }

    /**
     * @param {string} message
     */
    debug(message) {
        this.log('DEBUG', message);
    }

    /**
     * Log a summary of script execution
     * @param {number} processed - Number of items processed
     * @param {number} skipped - Number of items skipped
     * @param {number} [errors] - Number of errors encountered
     */
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

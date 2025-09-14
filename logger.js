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
 * - Log rotation with configurable size limits
 * - Automatic cleanup of old log files
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
 * Configuration:
 * - MAX_LOG_SIZE_MB: Maximum size per log file before rotation (default: 10MB)
 * - MAX_LOG_FILES: Maximum number of rotated files to keep (default: 5)
 * - LOG_RETENTION_DAYS: Maximum age of log files in days (default: 30)
 * 
 * Each script run starts with a session marker for easy separation.
 */

// External dependencies
const fs = require('fs');
const path = require('path');

// Log configuration constants
const MAX_LOG_SIZE_MB = parseInt(process.env.MAX_LOG_SIZE_MB) || 10;
const MAX_LOG_FILES = parseInt(process.env.MAX_LOG_FILES) || 5;
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS) || 30;

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

/**
 * Rotates a log file if it exceeds the maximum size
 * @param {string} logFile - Path to the log file
 */
function rotateLogFile(logFile) {
    try {
        // Check if file exists and its size
        if (!fs.existsSync(logFile)) return;
        
        const stats = fs.statSync(logFile);
        const fileSizeMB = stats.size / (1024 * 1024);
        
        if (fileSizeMB < MAX_LOG_SIZE_MB) return;
        
        const logDir = path.dirname(logFile);
        const logName = path.basename(logFile, '.log');
        
        // Rotate existing files (file.log.4 -> file.log.5, file.log.3 -> file.log.4, etc.)
        for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
            const oldFile = path.join(logDir, `${logName}.log.${i}`);
            const newFile = path.join(logDir, `${logName}.log.${i + 1}`);
            
            if (fs.existsSync(oldFile)) {
                if (i === MAX_LOG_FILES - 1) {
                    // Delete the oldest file
                    fs.unlinkSync(oldFile);
                } else {
                    // Move file to next number
                    fs.renameSync(oldFile, newFile);
                }
            }
        }
        
        // Move current log to .1
        const rotatedFile = path.join(logDir, `${logName}.log.1`);
        fs.renameSync(logFile, rotatedFile);
        
        console.log(`[Logger] Rotated log file: ${logFile} -> ${rotatedFile} (${fileSizeMB.toFixed(2)}MB)`);
    } catch (error) {
        console.error(`[Logger] Failed to rotate log file ${logFile}:`, error.message);
    }
}

/**
 * Cleans up old log files based on retention policy
 */
function cleanupOldLogs() {
    try {
        const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const cutoffTime = Date.now() - retentionMs;
        
        const logFiles = fs.readdirSync(logsDir);
        let deletedCount = 0;
        
        for (const file of logFiles) {
            if (!file.endsWith('.log') && !file.match(/\.log\.\d+$/)) continue;
            
            const filePath = path.join(logsDir, file);
            const stats = fs.statSync(filePath);
            
            if (stats.mtime.getTime() < cutoffTime) {
                fs.unlinkSync(filePath);
                deletedCount++;
            }
        }
        
        if (deletedCount > 0) {
            console.log(`[Logger] Cleaned up ${deletedCount} old log files (older than ${LOG_RETENTION_DAYS} days)`);
        }
    } catch (error) {
        console.error('[Logger] Failed to cleanup old logs:', error.message);
    }
}

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
        
        // Rotate log file if it's too large
        rotateLogFile(this.logFile);
        
        // Clean up old logs (only do this occasionally to avoid performance impact)
        if (Math.random() < 0.1) { // 10% chance
            cleanupOldLogs();
        }
        
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
        
        // Check for rotation occasionally during heavy logging (every ~100 log calls)
        if (Math.random() < 0.01) { // 1% chance
            rotateLogFile(this.logFile);
        }

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

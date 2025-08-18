/**
 * errorHandler.js - Global Error Handling System
 * 
 * Provides standardized error handling functionality for all scripts
 * in the Beacon Cinema Calendar Sync project.
 * 
 * Features:
 * - Global unhandled rejection and exception catching
 * - Standardized error message formatting
 * - Automatic logging to both file and console
 * - Process exit control for critical errors
 * - Parameter validation for all error handling functions
 * - Context-aware error reporting with script names
 * 
 * Usage:
 * const { setupErrorHandling, handleError } = require('./errorHandler');
 * setupErrorHandling(logger, 'scriptName');
 * handleError(logger, error, 'context', shouldExit);
 * 
 * @author Beacon Cinema Calendar Sync Project
 * @typedef {import('./types').Logger} Logger
 */

/**
 * Sets up standardized error handling for a script
 * @param {Logger} logger - Logger instance for the script
 * @param {string} scriptName - Name of the script for error context
 */
function setupErrorHandling(logger, scriptName) {
    // Parameter validation
    if (!logger || typeof logger !== 'object') {
        throw new Error('setupErrorHandling: logger must be a valid logger object');
    }
    if (!scriptName || typeof scriptName !== 'string') {
        throw new Error('setupErrorHandling: scriptName must be a non-empty string');
    }
    
    process.on('unhandledRejection', (reason) => {
        const errorMessage = `Unhandled promise rejection in ${scriptName}:`;
        // Log to file
        logger.error(errorMessage, reason);
        // Log to console with color
        console.error(`\x1b[31m[ERROR] ${errorMessage}\x1b[0m`);
        console.error('\x1b[31m', reason, '\x1b[0m');
        logger.summary(0, 0, 1);
        process.exit(1);
    });

    process.on('uncaughtException', (error) => {
        const errorMessage = `Uncaught exception in ${scriptName}:`;
        // Log to file
        logger.error(errorMessage, error);
        // Log to console with color
        console.error(`\x1b[31m[ERROR] ${errorMessage}\x1b[0m`);
        if (error.stack) {
            console.error('\x1b[31m', error.stack, '\x1b[0m');
        } else {
            console.error('\x1b[31m', error, '\x1b[0m');
        }
        logger.summary(0, 0, 1);
        process.exit(1);
    });
}

/**
 * Handles errors in a standardized way
 * @param {Logger} logger - Logger instance
 * @param {Error} error - Error to handle
 * @param {string} context - Context where the error occurred
 * @param {boolean} [exit=false] - Whether to exit the process
 */
function handleError(logger, error, context, exit = false) {
    // Parameter validation
    if (!logger || typeof logger !== 'object') {
        throw new Error('handleError: logger must be a valid logger object');
    }
    if (!error) {
        throw new Error('handleError: error parameter is required');
    }
    if (!context || typeof context !== 'string') {
        throw new Error('handleError: context must be a non-empty string');
    }
    if (typeof exit !== 'boolean') {
        throw new Error('handleError: exit must be a boolean');
    }
    
    const errorMessage = error instanceof Error ? `${context}: ${error.message}` : `${context}: ${error}`;
    
    // Log to file via logger
    logger.error(errorMessage);
    if (error instanceof Error && error.stack && !error.message.includes('ENOENT')) {
        logger.error(error.stack);
    }

    // Also output to console for immediate visibility
    console.error(`\x1b[31m[ERROR] ${errorMessage}\x1b[0m`);
    if (error instanceof Error && error.stack && !error.message.includes('ENOENT')) {
        console.error(`\x1b[31m${error.stack}\x1b[0m`);
    }

    if (exit) {
        logger.summary(0, 0, 1);
        process.exit(1);
    }
}

module.exports = {
    setupErrorHandling,
    handleError
};

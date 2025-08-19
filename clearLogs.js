/**
 * clearLogs.js - Log File Cleanup Utility
 * 
 * Empties all log files in the logs directory to start fresh.
 * Useful for clearing accumulated log data before running scripts
 * or when log files become too large.
 * 
 * Usage: node clearLogs.js
 * 
 * @author Beacon Cinema Calendar Sync Project
 */

// @ts-check
// External dependencies
const fs = require('fs');
const path = require('path');

// Internal dependencies
const logger = require('./logger')('clearLogs');
const { setupErrorHandling, handleError } = require('./errorHandler');

setupErrorHandling(logger, 'clearLogs.js');

/**
 * Clears all log files in the logs directory
 * @returns {Promise<void>}
 */
async function clearAllLogs() {
    try {
        logger.info('Starting log file cleanup...');
        
        const logsDir = path.join(__dirname, 'logs');
        
        // Check if logs directory exists
        if (!fs.existsSync(logsDir)) {
            logger.warn('Logs directory does not exist. Nothing to clear.');
            return;
        }
        
        // Read all files in logs directory
        const files = fs.readdirSync(logsDir);
        const logFiles = files.filter(file => file.endsWith('.log'));
        
        if (logFiles.length === 0) {
            logger.info('No log files found in logs directory.');
            return;
        }
        
        logger.info(`Found ${logFiles.length} log files to clear:`);
        logFiles.forEach(file => logger.info(`  - ${file}`));
        
        let clearedCount = 0;
        let errorCount = 0;
        
        // Clear each log file
        for (const logFile of logFiles) {
            const filePath = path.join(logsDir, logFile);
            
            try {
                // Check if file exists and get its size
                const stats = fs.statSync(filePath);
                const sizeKB = (stats.size / 1024).toFixed(2);
                
                // Empty the file by writing empty string
                fs.writeFileSync(filePath, '');
                logger.info(`Cleared ${logFile} (was ${sizeKB} KB)`);
                clearedCount++;
                
            } catch (error) {
                handleError(logger, error, `Failed to clear ${logFile}`);
                errorCount++;
            }
        }
        
        // Summary
        logger.info(`Log cleanup completed: ${clearedCount} files cleared, ${errorCount} errors`);
        logger.summary(clearedCount, 0, errorCount);
        
        if (errorCount === 0) {
            console.log('\x1b[32m[SUCCESS] All log files have been cleared.\x1b[0m');
        } else {
            console.log(`\x1b[33m[WARNING] ${clearedCount} files cleared, ${errorCount} errors occurred.\x1b[0m`);
        }
        
    } catch (error) {
        handleError(logger, error, 'Log cleanup failed', true);
    }
}

/**
 * Main execution
 */
if (require.main === module) {
    clearAllLogs();
}

module.exports = { clearAllLogs };

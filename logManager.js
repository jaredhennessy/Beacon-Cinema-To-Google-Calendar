/**
 * logManager.js - Log File Management Utilities
 * 
 * Provides utilities for managing log files including rotation,
 * cleanup, compression, and monitoring.
 * 
 * Usage:
 * const { rotateLogs, cleanupLogs, getLogStats, compressOldLogs } = require('./logManager');
 * 
 * @author Beacon Cinema Calendar Sync Project
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const logsDir = path.join(__dirname, 'logs');

// Configuration from environment variables or defaults
const MAX_LOG_SIZE_MB = parseInt(process.env.MAX_LOG_SIZE_MB) || 10;
const MAX_LOG_FILES = parseInt(process.env.MAX_LOG_FILES) || 5;
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS) || 30;
const COMPRESS_LOGS = process.env.COMPRESS_LOGS === 'true';

/**
 * Get statistics about log files
 * @returns {Object} Log statistics
 */
function getLogStats() {
    try {
        if (!fs.existsSync(logsDir)) {
            return { totalFiles: 0, totalSizeMB: 0, files: [] };
        }

        const files = fs.readdirSync(logsDir);
        const logFiles = files.filter(file => file.endsWith('.log') || file.match(/\.log\.\d+$/));
        
        let totalSize = 0;
        const fileStats = [];
        
        for (const file of logFiles) {
            const filePath = path.join(logsDir, file);
            const stats = fs.statSync(filePath);
            const sizeMB = stats.size / (1024 * 1024);
            totalSize += sizeMB;
            
            fileStats.push({
                name: file,
                sizeMB: Math.round(sizeMB * 100) / 100,
                lastModified: stats.mtime,
                ageHours: Math.round((Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60))
            });
        }
        
        return {
            totalFiles: logFiles.length,
            totalSizeMB: Math.round(totalSize * 100) / 100,
            files: fileStats.sort((a, b) => b.sizeMB - a.sizeMB)
        };
    } catch (error) {
        console.error('Error getting log stats:', error.message);
        return { totalFiles: 0, totalSizeMB: 0, files: [], error: error.message };
    }
}

/**
 * Force rotation of all log files that exceed size limit
 * @returns {Object} Rotation results
 */
function rotateLogs() {
    try {
        if (!fs.existsSync(logsDir)) {
            return { rotated: 0, errors: [] };
        }

        const files = fs.readdirSync(logsDir);
        const logFiles = files.filter(file => file.endsWith('.log'));
        
        let rotatedCount = 0;
        const errors = [];
        
        for (const file of logFiles) {
            const filePath = path.join(logsDir, file);
            const stats = fs.statSync(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);
            
            if (fileSizeMB >= MAX_LOG_SIZE_MB) {
                try {
                    rotateLogFile(filePath);
                    rotatedCount++;
                } catch (error) {
                    errors.push({ file, error: error.message });
                }
            }
        }
        
        return { rotated: rotatedCount, errors };
    } catch (error) {
        return { rotated: 0, errors: [{ general: error.message }] };
    }
}

/**
 * Rotate a single log file
 * @param {string} logFile - Path to the log file
 */
function rotateLogFile(logFile) {
    const logDir = path.dirname(logFile);
    const logName = path.basename(logFile, '.log');
    
    // Rotate existing files
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
        const oldFile = path.join(logDir, `${logName}.log.${i}`);
        const newFile = path.join(logDir, `${logName}.log.${i + 1}`);
        
        if (fs.existsSync(oldFile)) {
            if (i === MAX_LOG_FILES - 1) {
                fs.unlinkSync(oldFile);
            } else {
                fs.renameSync(oldFile, newFile);
            }
        }
    }
    
    // Move current log to .1
    const rotatedFile = path.join(logDir, `${logName}.log.1`);
    fs.renameSync(logFile, rotatedFile);
    
    // Compress if enabled
    if (COMPRESS_LOGS && process.platform !== 'win32') {
        try {
            execSync(`gzip "${rotatedFile}"`, { stdio: 'pipe' });
        } catch (error) {
            console.warn(`Failed to compress ${rotatedFile}:`, error.message);
        }
    }
}

/**
 * Clean up old log files based on retention policy
 * @returns {Object} Cleanup results
 */
function cleanupLogs() {
    try {
        if (!fs.existsSync(logsDir)) {
            return { deleted: 0, errors: [] };
        }

        const retentionMs = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const cutoffTime = Date.now() - retentionMs;
        
        const files = fs.readdirSync(logsDir);
        const logFiles = files.filter(file => 
            file.endsWith('.log') || 
            file.match(/\.log\.\d+$/) || 
            file.endsWith('.log.gz')
        );
        
        let deletedCount = 0;
        const errors = [];
        
        for (const file of logFiles) {
            const filePath = path.join(logsDir, file);
            const stats = fs.statSync(filePath);
            
            if (stats.mtime.getTime() < cutoffTime) {
                try {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                } catch (error) {
                    errors.push({ file, error: error.message });
                }
            }
        }
        
        return { deleted: deletedCount, errors, retentionDays: LOG_RETENTION_DAYS };
    } catch (error) {
        return { deleted: 0, errors: [{ general: error.message }] };
    }
}

/**
 * Compress old log files to save space
 * @returns {Object} Compression results
 */
function compressOldLogs() {
    if (process.platform === 'win32') {
        return { compressed: 0, errors: [{ general: 'Compression not supported on Windows' }] };
    }
    
    try {
        if (!fs.existsSync(logsDir)) {
            return { compressed: 0, errors: [] };
        }

        const files = fs.readdirSync(logsDir);
        const rotatedLogs = files.filter(file => file.match(/\.log\.\d+$/) && !file.endsWith('.gz'));
        
        let compressedCount = 0;
        const errors = [];
        
        for (const file of rotatedLogs) {
            const filePath = path.join(logsDir, file);
            try {
                execSync(`gzip "${filePath}"`, { stdio: 'pipe' });
                compressedCount++;
            } catch (error) {
                errors.push({ file, error: error.message });
            }
        }
        
        return { compressed: compressedCount, errors };
    } catch (error) {
        return { compressed: 0, errors: [{ general: error.message }] };
    }
}

/**
 * Run complete log maintenance
 * @returns {Object} Maintenance results
 */
function maintainLogs() {
    console.log('[LogManager] Starting log maintenance...');
    
    const stats = getLogStats();
    console.log(`[LogManager] Current: ${stats.totalFiles} files, ${stats.totalSizeMB}MB total`);
    
    const rotateResults = rotateLogs();
    if (rotateResults.rotated > 0) {
        console.log(`[LogManager] Rotated ${rotateResults.rotated} log files`);
    }
    
    const compressResults = compressOldLogs();
    if (compressResults.compressed > 0) {
        console.log(`[LogManager] Compressed ${compressResults.compressed} old log files`);
    }
    
    const cleanupResults = cleanupLogs();
    if (cleanupResults.deleted > 0) {
        console.log(`[LogManager] Deleted ${cleanupResults.deleted} old log files (older than ${cleanupResults.retentionDays} days)`);
    }
    
    const finalStats = getLogStats();
    console.log(`[LogManager] Final: ${finalStats.totalFiles} files, ${finalStats.totalSizeMB}MB total`);
    
    return {
        initial: stats,
        rotated: rotateResults.rotated,
        compressed: compressResults.compressed,
        deleted: cleanupResults.deleted,
        final: finalStats
    };
}

// CLI interface
if (require.main === module) {
    const command = process.argv[2];
    
    switch (command) {
        case 'stats':
            const stats = getLogStats();
            console.log('Log File Statistics:');
            console.log(`Total Files: ${stats.totalFiles}`);
            console.log(`Total Size: ${stats.totalSizeMB}MB`);
            console.log('\nFiles:');
            stats.files.forEach(file => {
                console.log(`  ${file.name}: ${file.sizeMB}MB (${file.ageHours}h old)`);
            });
            break;
            
        case 'rotate':
            const rotateResults = rotateLogs();
            console.log(`Rotated ${rotateResults.rotated} log files`);
            if (rotateResults.errors.length > 0) {
                console.log('Errors:', rotateResults.errors);
            }
            break;
            
        case 'cleanup':
            const cleanupResults = cleanupLogs();
            console.log(`Deleted ${cleanupResults.deleted} old log files`);
            if (cleanupResults.errors.length > 0) {
                console.log('Errors:', cleanupResults.errors);
            }
            break;
            
        case 'compress':
            const compressResults = compressOldLogs();
            console.log(`Compressed ${compressResults.compressed} log files`);
            if (compressResults.errors.length > 0) {
                console.log('Errors:', compressResults.errors);
            }
            break;
            
        case 'maintain':
        default:
            maintainLogs();
            break;
    }
}

module.exports = {
    getLogStats,
    rotateLogs,
    cleanupLogs,
    compressOldLogs,
    maintainLogs
};
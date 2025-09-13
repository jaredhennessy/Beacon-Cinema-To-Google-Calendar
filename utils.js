/**
 * utils.js - Shared Utilities Library
 * 
 * Provides common utilities for Google Sheets operations, file management, network handling,
 * and data validation used across all scripts in the Beacon Cinema Calendar Sync project.
 * 
 * Key Features:
 * - Deduplication of rows
 * - Robust file existence checking for script files
 * - Network timeout handling with retry logic for Puppeteer navigation
 * - Comprehensive parameter validation for all functions
 * - Series data filtering and runtime information merging
 * 
 * @author Beacon Cinema Calendar Sync Project
 * @typedef {import('./types').SeriesRow} SeriesRow
 * @typedef {import('./types').ScheduleRow} ScheduleRow
 * @typedef {import('./types').RuntimeRow} RuntimeRow
 * @typedef {import('./types').SeriesIndexRow} SeriesIndexRow 
 */

// @ts-check
// External dependencies
const path = require('path');

// Internal dependencies
const logger = require('./logger')('utils');

/**
 * Ensures the CSV file at filePath starts with the expected header.
 * The expected header must be provided as a string (e.g., "Title,Date,Time").
 * If the file does not exist, it is created with the header.
 * If the header is missing, it is prepended.
 * @param {string} filePath - Path to the CSV file.
 * @param {string} expectedHeader - The exact header row (comma-separated) that should be present at the top of the file.
 */
// Removed ensureHeader utility (obsolete with Google Sheets)

/**
 * Deduplicates an array of objects by a key function.
 * @template T
 * @param {T[]} rows - Array of objects to deduplicate.
 * @param {(row: T) => string} keyFn - Function that returns a unique key for each row.
 * @returns {T[]} Deduplicated array
 */
function deduplicateRows(rows, keyFn) {
    // Parameter validation
    if (!Array.isArray(rows)) {
        throw new Error('deduplicateRows: rows must be an array');
    }
    if (typeof keyFn !== 'function') {
        throw new Error('deduplicateRows: keyFn must be a function');
    }

    const seen = new Set();
    const result = [];
    for (const row of rows) {
        const key = keyFn(row);
        if (!seen.has(key)) {
            seen.add(key);
            result.push(row);
        }
    }
    return result;
}

/**
 * Warns if duplicate rows exist in a CSV file (excluding header)
 * @param {string} filePath - Path to the CSV file to check for duplicates
 * @returns {void}
 */
// Removed warnIfDuplicateRows utility (obsolete with Google Sheets)

/**
 * Reads the header row from a CSV file.
 * @param {string} filePath - Path to the CSV file.
 * @returns {string|null} The header row, or null if file does not exist or is empty
 */
// Removed readCsvHeader utility (obsolete with Google Sheets)

/**
 * Filter series records by series tag
 * @param {SeriesRow[]} records - Array of series records
 * @param {string} seriesTag - Tag to filter by
 * @returns {SeriesRow[]} Filtered records
 */
function filterSeriesByTag(records, seriesTag) {
    // Parameter validation
    if (!records || !Array.isArray(records)) {
        throw new Error('filterSeriesByTag: records must be an array');
    }
    if (!seriesTag || typeof seriesTag !== 'string') {
        throw new Error('filterSeriesByTag: seriesTag must be a non-empty string');
    }
    
    return records.filter(record => record.SeriesTag === seriesTag);
}

/**
 * Merges runtime information into schedule records
 * @param {ScheduleRow[]} scheduleRecords - Array of schedule records
 * @param {RuntimeRow[]} runtimeRecords - Array of runtime records
 * @returns {(ScheduleRow & { Runtime?: string })[]} Schedule records with runtime info
 */
function mergeRuntimeInfo(scheduleRecords, runtimeRecords) {
    // Parameter validation
    if (!scheduleRecords || !Array.isArray(scheduleRecords)) {
        throw new Error('mergeRuntimeInfo: scheduleRecords must be an array');
    }
    if (!runtimeRecords || !Array.isArray(runtimeRecords)) {
        throw new Error('mergeRuntimeInfo: runtimeRecords must be an array');
    }
    
    const runtimeMap = new Map(runtimeRecords.map(r => [r.Title, r.Runtime]));
    
    return scheduleRecords.map(record => ({
        ...record,
        Runtime: runtimeMap.get(record.Title)
    }));
}

/**
 * Validate series index row
 * @param {SeriesIndexRow} row - Row to validate
 * @returns {{ isValid: boolean, errors: string[] }} Validation result
 */
function validateSeriesIndexRow(row) {
    // Parameter validation
    if (!row || typeof row !== 'object') {
        throw new Error('validateSeriesIndexRow: row must be a valid object');
    }
    
    const errors = [];
    
    if (!row.seriesName?.trim()) {
        errors.push('Series name is required');
    }
    if (!row.seriesTag?.trim()) {
        errors.push('Series tag is required');
    }
    if (!row.seriesURL?.startsWith('https://thebeacon.film/')) {
        errors.push('Series URL must be a valid Beacon Cinema URL');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Check if a file exists and validate its state
 * @param {string} filePath - Path to the file to check
 * @param {Object} [options] - Options for the check
 * @param {boolean} [options.required=false] - Whether the file must exist
 * @param {string} [options.missingMessage] - Custom message if file is missing
 * @param {boolean} [options.createIfMissing=false] - Whether to create the file if missing
 * @param {string} [options.initialContent=''] - Content to write if creating file
 * @param {string} [options.parentScript] - Name of calling script for error context
 * @throws {Error} If file is required and missing, with detailed message
 * @returns {boolean} Whether the file exists
 */
function checkFile(filePath, options = {}) {
    const {
        required = false,
        missingMessage = null,
        parentScript = ''
    } = options;

    // Only check for existence of script files (not data files)
    try {
        require.resolve(filePath);
        return true;
    } catch (err) {
        if (required) {
            const context = parentScript ? ` in ${parentScript}` : '';
            const message = missingMessage || `Required file not found: ${filePath}${context}`;
            throw new Error(message);
        }
        return false;
    }
}

/**
 * Navigates to a URL with enhanced timeout handling and retry logic.
 * @param {Object} page - Puppeteer page object
 * @param {string} url - URL to navigate to
 * @param {Object} options - Navigation options
 * @param {number} [options.timeout=60000] - Navigation timeout in milliseconds
 * @param {number} [options.maxRetries=2] - Maximum number of retry attempts
 * @param {string} [options.waitUntil='networkidle2'] - When to consider navigation complete
 * @param {Object} [options.logger] - Logger instance for reporting progress
 * @returns {Promise<boolean>} Whether navigation was successful
 */
async function navigateWithRetry(page, url, options = {}) {
    const {
        timeout = 60000,
        maxRetries = 2,
        waitUntil = 'networkidle2',
        logger: pageLogger = logger
    } = options;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
            /** @type {any} */ (pageLogger).info(`Navigating to ${url}${attempt > 1 ? ` (attempt ${attempt})` : ''}...`);
            await /** @type {any} */ (page).goto(url, { waitUntil, timeout });
            return true;
        } catch (error) {
            if (error instanceof Error && error.message.includes('Navigation timeout')) {
                if (attempt <= maxRetries) {
                    /** @type {any} */ (pageLogger).warn(`Navigation timeout for ${url}, retrying (${attempt}/${maxRetries})...`);
                    continue;
                } else {
                    /** @type {any} */ (pageLogger).error(`Navigation timeout for ${url} after ${maxRetries} retries`);
                    return false;
                }
            } else {
                // Non-timeout errors should be handled by the caller
                throw error;
            }
        }
    }
    return false;
}

module.exports = {
    deduplicateRows,
    filterSeriesByTag,
    mergeRuntimeInfo,
    validateSeriesIndexRow,
    checkFile,
    navigateWithRetry
};

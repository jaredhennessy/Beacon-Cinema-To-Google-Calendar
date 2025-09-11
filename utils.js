/**
 * utils.js - Shared Utilities Library
 * 
 * Provides common utilities for CSV operations, file management, network handling,
 * and data validation used across all scripts in the Beacon Cinema Calendar Sync project.
 * 
 * Key Features:
 * - CSV header validation and deduplication
 * - Robust file existence checking with detailed error messages
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
const fs = require('fs');
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
function ensureHeader(filePath, expectedHeader) {
    // Parameter validation
    if (!filePath || typeof filePath !== 'string') {
        throw new Error('ensureHeader: filePath must be a non-empty string');
    }
    if (!expectedHeader || typeof expectedHeader !== 'string') {
        throw new Error('ensureHeader: expectedHeader must be a non-empty string');
    }

    // Create file with header if it doesn't exist
    checkFile(filePath, {
        createIfMissing: true,
        initialContent: expectedHeader + '\n'
    });

    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) {
        fs.writeFileSync(filePath, expectedHeader + '\n');
        logger.warn(`${filePath} was empty. Header inserted.`);
        return;
    }

    const firstLine = content.split('\n')[0];
    if (firstLine.replace(/\s/g, '').toLowerCase() !== expectedHeader.replace(/\s/g, '').toLowerCase()) {
        fs.writeFileSync(filePath, expectedHeader + '\n' + content);
        logger.warn(`${filePath} was missing a proper header row. Header inserted.`);
    }
}

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
function warnIfDuplicateRows(filePath) {
    // Parameter validation
    if (!filePath || typeof filePath !== 'string') {
        throw new Error('warnIfDuplicateRows: filePath must be a non-empty string');
    }

    if (!fs.existsSync(filePath)) return;
    
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1);
    const seen = new Set();
    let duplicateFound = false;
    
    for (const line of lines) {
        if (seen.has(line)) duplicateFound = true;
        seen.add(line);
    }
    
    if (duplicateFound) {
        logger.warn(`Duplicate rows found in ${filePath}.`);
    }
}

/**
 * Reads the header row from a CSV file.
 * @param {string} filePath - Path to the CSV file.
 * @returns {string|null} The header row, or null if file does not exist or is empty
 */
function readCsvHeader(filePath) {
    // Parameter validation
    if (!filePath || typeof filePath !== 'string') {
        throw new Error('readCsvHeader: filePath must be a non-empty string');
    }
    
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) return null;
    return content.split('\n')[0];
}

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
        createIfMissing = false,
        initialContent = '',
        parentScript = ''
    } = options;

    if (!fs.existsSync(filePath)) {
        if (createIfMissing) {
            // Ensure directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, initialContent);
            logger.info(`Created ${filePath}${initialContent ? ' with initial content' : ''}.`);
            return true;
        }
        
        if (required) {
            const context = parentScript ? ` in ${parentScript}` : '';
            const message = missingMessage || `Required file not found: ${filePath}${context}`;
            throw new Error(message);
        }
        
        return false;
    }
    
    return true;
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
    ensureHeader,
    deduplicateRows,
    warnIfDuplicateRows,
    readCsvHeader,
    filterSeriesByTag,
    mergeRuntimeInfo,
    validateSeriesIndexRow,
    checkFile,
    navigateWithRetry
};

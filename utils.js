/**
 * utils.js
 * Common CSV utilities for header checking and deduplication.
 * Used by all major scripts in this project.
 */

const fs = require('fs');
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
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, expectedHeader + '\n');
        logger.info(`Created ${filePath} with header row.`);
        return;
    }
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
 * @param {Array} rows - Array of objects to deduplicate.
 * @param {Function} keyFn - Function that returns a unique key for each row.
 * @returns {Array} Deduplicated array.
 */
function deduplicateRows(rows, keyFn) {
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
 * Warns if duplicate rows exist in a CSV file (excluding header).
 * @param {string} filePath - Path to the CSV file.
 */
function warnIfDuplicateRows(filePath) {
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
 * @returns {string|null} The header row, or null if file does not exist or is empty.
 */
function readCsvHeader(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) return null;
    return content.split('\n')[0];
}

module.exports = {
    ensureHeader,
    deduplicateRows,
    warnIfDuplicateRows,
    readCsvHeader,
};

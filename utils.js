/**
 * utils.js - Shared Utilities Library
 *
 * Provides date/time parsing, network handling, and data validation helpers used across
 * the scripts in the Beacon Cinema Calendar Sync project. Google Sheets reads and writes
 * live in sheetsUtils.js, not here.
 *
 * Key Features:
 * - Rebuilding dates and times from the calendar's year-less, 12-hour labels
 * - Timezone-independent date arithmetic
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
// Internal dependencies
const logger = require('./logger')('utils');

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

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Converts a calendar day label into an ISO date.
 *
 * The Beacon's calendar renders day headings like "Saturday, July 25" and never
 * emits a year anywhere on the page, so the year has to be inferred. Candidate
 * years around the reference date are tested and the one whose weekday matches
 * the label wins; proximity to the reference date breaks ties. The weekday check
 * is what keeps a December-to-January render from silently landing a year early.
 *
 * @param {string} dayLabel - Day heading, e.g. "Saturday, July 25" or "July 25".
 * @param {Date} [referenceDate] - Date used to pick the candidate years (defaults to now).
 * @returns {string|null} Date as YYYY-MM-DD, or null if the label is unparseable.
 */
function parseCalendarDate(dayLabel, referenceDate = new Date()) {
    // Parameter validation
    if (!dayLabel || typeof dayLabel !== 'string') {
        throw new Error('parseCalendarDate: dayLabel must be a non-empty string');
    }
    if (!(referenceDate instanceof Date) || Number.isNaN(referenceDate.getTime())) {
        throw new Error('parseCalendarDate: referenceDate must be a valid Date');
    }

    const match = dayLabel.trim().match(/^(?:([A-Za-z]+),\s*)?([A-Za-z]+)\s+(\d{1,2})$/);
    if (!match) return null;

    const [, weekdayRaw, monthRaw, dayRaw] = match;
    const month = MONTH_NAMES.indexOf(monthRaw.toLowerCase());
    const day = parseInt(dayRaw, 10);
    if (month === -1 || day < 1 || day > 31) return null;

    const expectedWeekday = weekdayRaw ? WEEKDAY_NAMES.indexOf(weekdayRaw.toLowerCase()) : -1;
    const referenceUtc = Date.UTC(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());

    let best = null;
    for (const year of [referenceDate.getFullYear() - 1, referenceDate.getFullYear(), referenceDate.getFullYear() + 1]) {
        const utc = Date.UTC(year, month, day);
        const candidate = new Date(utc);
        // Reject impossible dates such as Feb 30, which JS rolls into March.
        if (candidate.getUTCMonth() !== month || candidate.getUTCDate() !== day) continue;

        const weekdayMatches = expectedWeekday === -1 || candidate.getUTCDay() === expectedWeekday;
        const distance = Math.abs(utc - referenceUtc);
        if (!best
            || (weekdayMatches && !best.weekdayMatches)
            || (weekdayMatches === best.weekdayMatches && distance < best.distance)) {
            best = { year, distance, weekdayMatches };
        }
    }
    if (!best) return null;

    if (!best.weekdayMatches) {
        logger.warn(`parseCalendarDate: no candidate year puts "${dayLabel}" on that weekday; assuming ${best.year}.`);
    }

    return `${best.year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Converts a 12-hour clock string into 24-hour HH:MM.
 * The calendar renders showtimes as "7:00 PM"; downstream consumers expect HH:MM.
 * @param {string} timeText - Time such as "7:00 PM", "10:30 pm", or "7 PM".
 * @returns {string|null} Time as HH:MM, or null if unparseable.
 */
function parseTime12h(timeText) {
    // Parameter validation
    if (!timeText || typeof timeText !== 'string') {
        throw new Error('parseTime12h: timeText must be a non-empty string');
    }

    const match = timeText.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?$/);
    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = match[2] ? parseInt(match[2], 10) : 0;
    if (hours < 1 || hours > 12 || minutes > 59) return null;

    if (hours === 12) hours = 0;
    if (match[3].toLowerCase() === 'p') hours += 12;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * Adds a whole number of days to an ISO date string.
 * Uses UTC arithmetic so the result never depends on the runner's timezone or DST.
 * @param {string} dateStr - Date as YYYY-MM-DD.
 * @param {number} days - Days to add (may be negative).
 * @returns {string} Resulting date as YYYY-MM-DD.
 */
function addDaysToISODate(dateStr, days) {
    // Parameter validation
    if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        throw new Error('addDaysToISODate: dateStr must be a date string in YYYY-MM-DD format');
    }
    if (!Number.isInteger(days)) {
        throw new Error('addDaysToISODate: days must be an integer');
    }

    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day) + days * 86400000)
        .toISOString()
        .slice(0, 10);
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
 * @returns {Promise<Object|boolean>} The Puppeteer response on success (truthy) or false on failure.
 *   Callers that only need success/failure can keep testing truthiness; callers that
 *   care about the HTTP status can call `.status()` when it is available.
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
            const response = await /** @type {any} */ (page).goto(url, { waitUntil, timeout });
            // page.goto can legitimately resolve to null (e.g. same-document
            // navigation), so fall back to `true` to keep the truthy contract.
            return response || true;
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
    parseCalendarDate,
    parseTime12h,
    addDaysToISODate,
    filterSeriesByTag,
    mergeRuntimeInfo,
    validateSeriesIndexRow,
    checkFile,
    navigateWithRetry
};

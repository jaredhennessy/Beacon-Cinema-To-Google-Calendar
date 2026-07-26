/**
 * test/utils.test.js
 * Unit tests for the date and time helpers in utils.js.
 *
 * Usage: node test/utils.test.js   (or npm test)
 *
 * These guard the highest-risk logic in the project. The Beacon's calendar carries no
 * year anywhere on the page and no ISO datetimes — day headings read "Saturday, July 25"
 * and times read "7:00 PM" — so parseCalendarDate() infers the year and validates it
 * against the weekday in the label. A regression here does not fail loudly: the pipeline
 * reports success while writing every event a year off.
 *
 * Pure assertions, no network and no Google APIs. Requiring utils.js does pull in
 * ./logger, so running this touches logs/utils.log.
 *
 * Uses plain assert rather than a test framework, so there is no dependency to install and
 * this file stays runnable on its own.
 */

const { parseCalendarDate, parseTime12h, addDaysToISODate } = require('../utils');

let passed = 0;
const failures = [];

/**
 * Asserts a helper returns the expected value.
 * @param {string} label - What is being checked, shown on failure
 * @param {*} actual
 * @param {*} expected
 */
function check(label, actual, expected) {
    if (actual === expected) {
        passed++;
        return;
    }
    failures.push(
        `${label}\n    expected: ${JSON.stringify(expected)}` +
        `\n    actual:   ${JSON.stringify(actual)}`
    );
}

/**
 * Asserts a call throws, with a message matching a pattern.
 * @param {string} label
 * @param {Function} fn
 * @param {RegExp} pattern
 */
function checkThrows(label, fn, pattern) {
    try {
        fn();
    } catch (error) {
        if (pattern.test(error.message)) {
            passed++;
        } else {
            failures.push(`${label}\n    unexpected message: ${error.message}`);
        }
        return;
    }
    failures.push(`${label}\n    expected a throw, got none`);
}

// --- parseCalendarDate: labels as the live site renders them --------------------------
// Reference date is the day the calendar was rendered; the page shows the current month
// and the next one.
const july2026 = new Date(2026, 6, 25);

check('Saturday, July 25', parseCalendarDate('Saturday, July 25', july2026), '2026-07-25');
check('Sunday, July 26', parseCalendarDate('Sunday, July 26', july2026), '2026-07-26');
check('Monday, August 31', parseCalendarDate('Monday, August 31', july2026), '2026-08-31');
check('Sunday, August 30', parseCalendarDate('Sunday, August 30', july2026), '2026-08-30');

// --- parseCalendarDate: the year boundary --------------------------------------------
// The weekday in the label is what disambiguates these. Without that check, a December
// render showing January dates lands a year early and every January event is wrong.
const dec2026 = new Date(2026, 11, 20);
check('Friday, January 1 seen from Dec 2026 -> 2027',
    parseCalendarDate('Friday, January 1', dec2026), '2027-01-01');
check('Sunday, December 20 seen from Dec 2026 -> 2026',
    parseCalendarDate('Sunday, December 20', dec2026), '2026-12-20');

const jan2027 = new Date(2027, 0, 3);
check('Thursday, December 31 seen from Jan 2027 -> 2026',
    parseCalendarDate('Thursday, December 31', jan2027), '2026-12-31');
check('Friday, January 1 seen from Jan 2027 -> 2027',
    parseCalendarDate('Friday, January 1', jan2027), '2027-01-01');

// --- parseCalendarDate: leap day and impossible dates --------------------------------
check('Tuesday, February 29 in a leap year',
    parseCalendarDate('Tuesday, February 29', new Date(2028, 1, 1)), '2028-02-29');
check('February 30 is rejected rather than rolling into March',
    parseCalendarDate('February 30', july2026), null);
check('February 31 is rejected', parseCalendarDate('February 31', july2026), null);

// --- parseCalendarDate: tolerant and invalid input ------------------------------------
check('a label with no weekday still parses',
    parseCalendarDate('July 25', july2026), '2026-07-25');
check('unparseable label returns null',
    parseCalendarDate('Coming Soon', july2026), null);
check('an unknown month returns null',
    parseCalendarDate('Saturday, Smarch 25', july2026), null);
check('day 0 returns null', parseCalendarDate('July 0', july2026), null);
check('day 32 returns null', parseCalendarDate('July 32', july2026), null);

checkThrows('empty label throws', () => parseCalendarDate('', july2026), /non-empty string/);
checkThrows('non-string label throws', () => parseCalendarDate(42, july2026), /non-empty string/);
checkThrows('invalid reference date throws',
    () => parseCalendarDate('July 25', new Date('nope')), /valid Date/);

// --- parseTime12h --------------------------------------------------------------------
check('7:00 PM', parseTime12h('7:00 PM'), '19:00');
check('10:00 PM', parseTime12h('10:00 PM'), '22:00');
check('4:30 pm lowercase', parseTime12h('4:30 pm'), '16:30');
check('12:00 AM is midnight', parseTime12h('12:00 AM'), '00:00');
check('12:30 PM stays afternoon', parseTime12h('12:30 PM'), '12:30');
check('12:00 PM is noon', parseTime12h('12:00 PM'), '12:00');
check('1:05 AM', parseTime12h('1:05 AM'), '01:05');
check('7 PM without minutes', parseTime12h('7 PM'), '19:00');
check('7:00 P.M. with periods', parseTime12h('7:00 P.M.'), '19:00');
check('surrounding whitespace tolerated', parseTime12h('  8:15 PM  '), '20:15');
check('non-time text returns null', parseTime12h('Sold Out'), null);
check('24-hour input returns null', parseTime12h('19:00'), null);
check('hour 13 returns null', parseTime12h('13:00 PM'), null);
check('hour 0 returns null', parseTime12h('0:30 AM'), null);
check('minute 60 returns null', parseTime12h('7:60 PM'), null);

checkThrows('empty time throws', () => parseTime12h(''), /non-empty string/);
checkThrows('non-string time throws', () => parseTime12h(null), /non-empty string/);

// --- addDaysToISODate ----------------------------------------------------------------
check('same day', addDaysToISODate('2026-07-25', 0), '2026-07-25');
check('across a month', addDaysToISODate('2026-07-31', 1), '2026-08-01');
check('across a year', addDaysToISODate('2026-12-31', 1), '2027-01-01');
check('into a leap day', addDaysToISODate('2028-02-28', 1), '2028-02-29');
check('past a leap day', addDaysToISODate('2028-02-29', 1), '2028-03-01');
check('non-leap February', addDaysToISODate('2027-02-28', 1), '2027-03-01');
check('negative offset', addDaysToISODate('2026-01-01', -1), '2025-12-31');

checkThrows('bad date format throws', () => addDaysToISODate('07/25/2026', 1), /YYYY-MM-DD/);
checkThrows('non-string date throws', () => addDaysToISODate(20260725, 1), /YYYY-MM-DD/);
checkThrows('fractional days throws', () => addDaysToISODate('2026-07-25', 1.5), /integer/);

// --- updateGCal end-time arithmetic --------------------------------------------------
// Mirrors the calculation in updateGCal.js. A late show running past midnight used to
// reuse the start date, producing an end timestamp before the start, which the Google
// Calendar API rejects outright. The live calendar regularly carries 10:00 PM showtimes.
function endDateTime(date, time, durationMinutes) {
    const [hours, minutes] = time.split(':').map(Number);
    const total = hours * 60 + minutes + durationMinutes;
    const endDate = addDaysToISODate(date, Math.floor(total / 1440));
    const endHours = String(Math.floor((total % 1440) / 60)).padStart(2, '0');
    const endMinutes = String(total % 60).padStart(2, '0');
    return `${endDate}T${endHours}:${endMinutes}:00`;
}

check('7:00 PM plus 111+15 min stays on the same day',
    endDateTime('2026-07-25', '19:00', 126), '2026-07-25T21:06:00');
check('10:00 PM plus 148+15 min rolls to the next day',
    endDateTime('2026-07-25', '22:00', 163), '2026-07-26T00:43:00');
check('10:00 PM plus the 2 hour default rolls across new year',
    endDateTime('2026-12-31', '22:00', 120), '2027-01-01T00:00:00');
check('an end landing exactly at midnight',
    endDateTime('2026-07-25', '22:00', 120), '2026-07-26T00:00:00');

// --- Round-trip sweep ----------------------------------------------------------------
// Every real date across three years, at reference offsets a live run could see: the same
// day, either side of it for the UTC skew on Render, and up to 45 days earlier because the
// page also renders next month. This is the strongest guard on year inference.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

let roundTrips = 0;
const roundTripFailures = [];
for (let time = Date.UTC(2026, 0, 1); time <= Date.UTC(2028, 11, 31); time += 86400000) {
    const day = new Date(time);
    const label = `${WEEKDAYS[day.getUTCDay()]}, ${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`;
    const expected = day.toISOString().slice(0, 10);

    for (const offsetDays of [0, -1, 1, -20, -45]) {
        const actual = parseCalendarDate(label, new Date(time + offsetDays * 86400000));
        roundTrips++;
        if (actual !== expected && roundTripFailures.length < 5) {
            roundTripFailures.push(`${label} at offset ${offsetDays}: got ${actual}, want ${expected}`);
        }
    }
}

if (roundTripFailures.length > 0) {
    failures.push(`date round-trip sweep\n    ${roundTripFailures.join('\n    ')}`);
} else {
    passed++;
}

// --- Report --------------------------------------------------------------------------
if (failures.length > 0) {
    console.error(`\nutils: ${failures.length} FAILED, ${passed} passed\n`);
    failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}\n`));
    process.exit(1);
}

console.log(`utils: all ${passed} assertions passed, including a ${roundTrips}-case date round-trip`);

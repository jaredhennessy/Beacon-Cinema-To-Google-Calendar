/**
 * titleCase.js
 * Converts The Beacon's all-caps titles into title case.
 *
 * The site stores every film title in capitals, so the original casing is gone and has
 * to be reconstructed. Most of that is rule-based, but some tokens cannot be derived from
 * an all-caps source at all, and those live in titleCasing.json so the vocabulary can be
 * extended without touching this logic:
 *
 * - `minorWords`     articles, conjunctions and short prepositions that stay lowercase
 *                    inside a title, but are still capitalized when they open the title,
 *                    open a subtitle, or close the title.
 * - `romanNumerals`  sequel numbers that must stay capitalized, as in "Exorcist II".
 *                    An explicit list is used rather than a /^[IVXLCDM]+$/ pattern
 *                    because ordinary words such as MIX, DID, LIVID and CIVIL are also
 *                    valid roman numerals and would be wrecked by the pattern.
 * - `exactCase`      acronyms and names whose casing cannot be inferred, such as "VHS"
 *                    and "McPherson". Keys are lowercase; values are the exact output.
 *
 * Ordinals ("13th") and hyphenated compounds ("All-Nighter") are handled by rule and
 * need no vocabulary. Only `exactCase` is expected to grow over time — add an entry when
 * a new film's acronym comes out wrong.
 *
 * Deliberately NOT in exactCase: "la" and "us", because they are the French article and
 * the English pronoun far more often than they are Los Angeles or the United States.
 *
 * Usage: const { titleCase } = require('./titleCase');
 */

const casing = require('./titleCasing.json');

const MINOR_WORDS = new Set(casing.minorWords.map(word => word.toLowerCase()));

// Roman numerals and exact-case entries resolve the same way, so they share one lookup.
const EXACT_CASE = new Map([
    ...casing.romanNumerals.map(numeral => [numeral.toLowerCase(), numeral]),
    ...Object.entries(casing.exactCase).map(([key, value]) => [key.toLowerCase(), value])
]);

// "13th" and "3rd" are lowercase wherever they appear — never "13Th".
const ORDINAL = /^\d+(?:st|nd|rd|th)$/;

// Splits a token into leading punctuation, core, and trailing punctuation.
const EDGES = /^([^\p{L}\p{N}]*)([\s\S]*?)([^\p{L}\p{N}]*)$/u;

// A colon, dash or sentence-ending mark means the next word opens a new phrase.
const PHRASE_END = /[:;.!?–—-]$/;

/**
 * Capitalizes the first letter of a word, leaving the rest lowercase.
 * Matches any Unicode letter, so an accented initial is handled correctly — a plain
 * [a-zA-Z] test skips past it and capitalizes the second letter, turning "ÜBER" into
 * "ÜBer".
 * @param {string} word
 * @returns {string}
 */
function capitalizeWord(word) {
    const chars = [...word];
    const firstLetter = chars.findIndex(char => /\p{L}/u.test(char));
    if (firstLetter === -1) return word;

    return chars.slice(0, firstLetter).join('')
        + chars[firstLetter].toUpperCase()
        + chars.slice(firstLetter + 1).join('').toLowerCase();
}

/**
 * Reduces a token to its lookup key: letters, digits and slashes, lowercased.
 * @param {string} token
 * @returns {string}
 */
function lookupKey(token) {
    return token.replace(/[^\p{L}\p{N}/]/gu, '').toLowerCase();
}

/**
 * Swaps a token's core for a fixed spelling while keeping the punctuation around it,
 * so "II:" stays "II:" and "(WAISN)" stays "(WAISN)".
 * @param {string} token
 * @param {string} replacement
 * @returns {string}
 */
function applyExactCase(token, replacement) {
    const parts = token.match(EDGES);
    return parts ? parts[1] + replacement + parts[3] : replacement;
}

/**
 * Cases one hyphen-free segment.
 * @param {string} segment
 * @param {boolean} opensPhrase - Whether this segment starts the title or a subtitle
 * @param {boolean} isLast - Whether this segment ends the title
 * @returns {string}
 */
function caseSegment(segment, opensPhrase, isLast) {
    const key = lookupKey(segment);
    if (!key) return segment;

    const exact = EXACT_CASE.get(key);
    if (exact) return applyExactCase(segment, exact);

    if (ORDINAL.test(key)) return segment.toLowerCase();

    if (!opensPhrase && !isLast && MINOR_WORDS.has(key)) return segment.toLowerCase();

    return capitalizeWord(segment);
}

/**
 * Cases one space-delimited word, descending into hyphenated compounds.
 * @param {string} word
 * @param {boolean} opensPhrase
 * @param {boolean} isLast
 * @returns {string}
 */
function caseWord(word, opensPhrase, isLast) {
    if (!word.includes('-')) return caseSegment(word, opensPhrase, isLast);

    const segments = word.split('-');
    return segments.map((segment, index) => caseSegment(
        segment,
        // The head of a compound is always capitalized, so "The A-Frame" does not come
        // out as "The a-Frame". Later segments follow the minor-word rule, which gives
        // "Out-of-Towners" while still giving "Third-Annual".
        index === 0,
        isLast && index === segments.length - 1
    )).join('-');
}

/**
 * Converts a title to title case.
 * @param {string} str - Title as stored on the site, typically all caps
 * @returns {string} Title-cased string; empty string for null or undefined input
 */
function titleCase(str) {
    // Parameter validation
    if (str === null || str === undefined) {
        return '';
    }
    if (typeof str !== 'string') {
        throw new Error('titleCase: str must be a string');
    }

    const words = str.replace(/^"|"$/g, '').split(' ');
    let opensPhrase = true;

    return words.map((word, index) => {
        const startsHere = opensPhrase;
        opensPhrase = PHRASE_END.test(word);
        return caseWord(word, startsHere, index === words.length - 1);
    }).join(' ');
}

module.exports = { titleCase };

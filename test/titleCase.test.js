/**
 * test/titleCase.test.js
 * Unit tests for titleCase.js and the vocabulary in titleCasing.json.
 *
 * Usage: node test/titleCase.test.js   (or npm test)
 *
 * These are pure assertions — no network, no Chrome, no Google APIs, no env vars.
 * The Puppeteer diagnostics in testPuppeteer.js are a separate thing and are not
 * run by npm test, because they need a browser and internet access.
 *
 * Uses plain assert rather than a test framework, so there is no dependency to install and
 * this file stays runnable on its own.
 */

const assert = require('assert');
const { titleCase } = require('../titleCase');

let passed = 0;
const failures = [];

/**
 * Asserts that a source title cases to the expected output.
 * @param {string} input - Title as the site stores it, typically all caps
 * @param {string} expected - Expected title-cased output
 * @param {string} note - Why this case matters, shown on failure
 */
function check(input, expected, note) {
    let actual;
    try {
        actual = titleCase(input);
    } catch (error) {
        failures.push(`${note}\n    input:  ${JSON.stringify(input)}\n    threw:  ${error.message}`);
        return;
    }
    if (actual === expected) {
        passed++;
        return;
    }
    failures.push(
        `${note}\n    input:    ${JSON.stringify(input)}` +
        `\n    expected: ${JSON.stringify(expected)}` +
        `\n    actual:   ${JSON.stringify(actual)}`
    );
}

// --- The four reported defects -------------------------------------------------------
check('EXORCIST II: THE HERETIC', 'Exorcist II: The Heretic',
    'roman numeral preserved, and "The" capitalized because it follows a colon');
check('WELCOME II THE TERRORDOME', 'Welcome II the Terrordome',
    'roman numeral preserved mid-title while "the" stays lowercase');
check('VHS ÜBER ALLES PRESENTS…', 'VHS Über Alles Presents…',
    'acronym preserved, and an accented initial is not mangled into "ÜBer"');
check('FRIDAY THE 13TH', 'Friday the 13th',
    'ordinal lowercased, never "13Th"');
check('CHILDREN OF THE NIGHT: THE THIRD-ANNUAL BEACON ALL-NIGHTER',
    'Children of the Night: The Third-Annual Beacon All-Nighter',
    'both halves of each hyphenated compound are capitalized');

// --- Roman-numeral lookalikes --------------------------------------------------------
// These are the reason titleCasing.json holds an explicit numeral list instead of a
// /^[IVXLCDM]+$/ pattern. Each word below is a valid roman numeral. If someone
// "simplifies" the list into a regex, these are what break.
check('THE MIX', 'The Mix', 'MIX is a valid roman numeral but must stay a word');
check('WHO DID IT', 'Who Did It', 'DID is a valid roman numeral but must stay a word');
check('LIVID', 'Livid', 'LIVID is a valid roman numeral but must stay a word');
check('A CIVIL ACTION', 'A Civil Action', 'CIVIL is a valid roman numeral but must stay a word');
check('DIM SUM', 'Dim Sum', 'DIM is a valid roman numeral but must stay a word');
check('MILD MANNERED', 'Mild Mannered', 'MILD is a valid roman numeral but must stay a word');

// --- Other numerals and ordinals -----------------------------------------------------
check('ROCKY IV', 'Rocky IV', 'numeral as the final word');
check('EDWARD II', 'Edward II', 'numeral as the final word');
check('PHASE IV', 'Phase IV', 'numeral as the final word');
check('THE 13TH ANNUAL ON CINEMA OSCAR SPECIAL', 'The 13th Annual on Cinema Oscar Special',
    'ordinal mid-title');
check('THE 1ST AND 2ND PARTS', 'The 1st and 2nd Parts', 'st and nd ordinals');
check('TWIN PEAKS: THE RETURN (EP. 15-16)', 'Twin Peaks: The Return (Ep. 15-16)',
    'digits inside a hyphenated group and parentheses are left alone');

// --- Acronyms, including inside punctuation ------------------------------------------
check('WTO/99', 'WTO/99', 'acronym joined to digits by a slash');
check('WR: MYSTERIES OF THE ORGANISM', 'WR: Mysteries of the Organism',
    'two-letter acronym followed by a colon');
check('IWW PRESENTS THE WORKING CLASS GOES TO HEAVEN',
    'IWW Presents the Working Class Goes to Heaven', 'acronym opening the title');
check('SHORT FILMS FOR WASHINGTON IMMIGRANT SOLIDARITY NETWORK (WAISN)',
    'Short Films for Washington Immigrant Solidarity Network (WAISN)',
    'acronym wrapped in parentheses keeps them');
check('FARGO (SIFF CINEMA WORKERS UNION FUNDRASIER)',
    'Fargo (SIFF Cinema Workers Union Fundrasier)',
    'acronym with only a leading parenthesis');
check('ED WOOD: MADE IN HOLLYWOOD USA W/ WILL SLOAN',
    'Ed Wood: Made in Hollywood USA w/ Will Sloan',
    'acronym plus the "w/" abbreviation lowercased');
check('TRIBULATION 99 + THE MCPHERSON TAPE', 'Tribulation 99 + the McPherson Tape',
    'mixed-case surname from exactCase');

// Words deliberately absent from exactCase, because they are far more often the French
// article and the English pronoun than Los Angeles and the United States.
check('À NOUS LA LIBERTÉ', 'À Nous La Liberté', '"la" must not become "LA"');
check('ROSA LA ROSE, PUBLIC GIRL', 'Rosa La Rose, Public Girl', '"la" must not become "LA"');
check('TELL US A STORY', 'Tell Us a Story', '"us" must not become "US"');

// --- Hyphenated compounds ------------------------------------------------------------
check('J-HORROR DOUBLE FEATURE: RING + JU-ON', 'J-Horror Double Feature: Ring + Ju-On',
    'single-letter first segment, and a compound as the final word');
check('RE-ANIMATOR', 'Re-Animator', 'both segments capitalized');
check('THE A-FRAME', 'The A-Frame',
    'the head of a compound is capitalized even when it is a minor word');
check('THE SET-UP', 'The Set-Up', 'a minor word ending the title is capitalized');
check('ROTATING SIGNALS: THE CONTEMPORARY KOREAN AVANT-GARDE',
    'Rotating Signals: The Contemporary Korean Avant-Garde', 'compound as the final word');
check('THE OUT-OF-TOWNERS', 'The Out-of-Towners',
    'a minor word inside a compound stays lowercase');

// --- Minor words ---------------------------------------------------------------------
check('BASE METALS, PURE GOLD: THE SCORES OF ENNIO MORRICONE',
    'Base Metals, Pure Gold: The Scores of Ennio Morricone',
    'a comma must not defeat the minor-word lookup');
check('ONCE UPON A TIME IN THE WEST', 'Once Upon a Time in the West',
    '"Upon" is not a minor word, "a" and "in" and "the" are');
check('TWIN PEAKS: FIRE WALK WITH ME', 'Twin Peaks: Fire Walk with Me', '"with" is minor');
check('IN THE MOOD FOR LOVE', 'In the Mood for Love',
    'a minor word opening the title is capitalized');
check("A LIZARD IN A WOMAN'S SKIN", "A Lizard in a Woman's Skin", 'apostrophe preserved');
check('TAKE CARE OF MY CAT', 'Take Care of My Cat', '"of" is minor');
check('THE SPOOK WHO SAT BY THE DOOR', 'The Spook Who Sat by the Door', '"by" is minor');
check("URGH! A MUSIC WAR W/ THE PROFESSORS OF URGH",
    'Urgh! A Music War w/ the Professors of Urgh',
    'an exclamation mark starts a new phrase, so "A" is capitalized');
check("SECS FEST: SHORTS PROGRAM - LET'S MAKE A PORNO",
    "Secs Fest: Shorts Program - Let's Make a Porno",
    'a standalone dash starts a new phrase');
check('OF', 'Of', 'a lone minor word is both first and last, so it is capitalized');
check('THE ART OF', 'The Art Of', 'a minor word ending the title is capitalized');

// --- Unicode and other edges ---------------------------------------------------------
check('SÁTÁNTANGÓ', 'Sátántangó', 'accented characters lowercase correctly');
check('3 WOMEN', '3 Women', 'a leading digit-only word');
check('BOOM!', 'Boom!', 'trailing punctuation preserved');
check('?????? CINEMA', '?????? Cinema', 'a word with no letters is passed through');
check('', '', 'empty string');

// --- Input validation ----------------------------------------------------------------
try {
    assert.strictEqual(titleCase(null), '', 'null returns empty string');
    assert.strictEqual(titleCase(undefined), '', 'undefined returns empty string');
    passed += 2;
} catch (error) {
    failures.push(`null/undefined handling\n    ${error.message}`);
}

try {
    titleCase(42);
    failures.push('non-string input\n    expected a throw, got none');
} catch (error) {
    if (/must be a string/.test(error.message)) {
        passed++;
    } else {
        failures.push(`non-string input\n    unexpected message: ${error.message}`);
    }
}

// --- Vocabulary sanity ---------------------------------------------------------------
// Guards against edits to titleCasing.json that would not show up as a wrong title until
// some future film happens to use the affected word.
const casing = require('../titleCasing.json');

try {
    assert.ok(Array.isArray(casing.minorWords) && casing.minorWords.length > 0,
        'minorWords must be a non-empty array');
    assert.ok(Array.isArray(casing.romanNumerals) && casing.romanNumerals.length > 0,
        'romanNumerals must be a non-empty array');
    assert.ok(casing.exactCase && typeof casing.exactCase === 'object',
        'exactCase must be an object');

    for (const word of casing.minorWords) {
        assert.strictEqual(word, word.toLowerCase(), `minorWords entry must be lowercase: ${word}`);
    }
    for (const key of Object.keys(casing.exactCase)) {
        assert.strictEqual(key, key.toLowerCase(), `exactCase key must be lowercase: ${key}`);
    }
    // An entry in both lists would be ambiguous: exactCase wins, silently overriding
    // the minor-word rule.
    const minor = new Set(casing.minorWords);
    const collisions = Object.keys(casing.exactCase).filter(key => minor.has(key));
    assert.deepStrictEqual(collisions, [],
        `these words are in both minorWords and exactCase: ${collisions.join(', ')}`);
    passed += 4;
} catch (error) {
    failures.push(`titleCasing.json sanity\n    ${error.message}`);
}

// --- Report --------------------------------------------------------------------------
if (failures.length > 0) {
    console.error(`\ntitleCase: ${failures.length} FAILED, ${passed} passed\n`);
    failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}\n`));
    process.exit(1);
}

console.log(`titleCase: all ${passed} assertions passed`);

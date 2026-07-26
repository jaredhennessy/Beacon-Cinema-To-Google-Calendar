/**
 * discoverSeries.js
 * Keeps Google Sheet 'seriesIndex' in step with the site's own series listings.
 * Usage: node discoverSeries.js
 * - Reads the site's series and program indexes and collects every currently running entry.
 * - Appends entries that are not already in 'seriesIndex', keyed by URL.
 * - Leaves rows already in the sheet untouched, so hand-picked seriesTag values survive.
 * - Validates every new row before writing.
 * Dependencies: puppeteer, ./utils.js, ./sheetsUtils.js
 */

require('dotenv').config();

// External dependencies
const { launchPuppeteerQuiet } = require('./puppeteerConfig');
const { getSheetRows, setSheetRows } = require('./sheetsUtils');

// Internal dependencies
const { navigateWithRetry, validateSeriesIndexRow } = require('./utils');
const logger = require('./logger')('discoverSeries');
const { setupErrorHandling, handleError } = require('./errorHandler');

const SITE = 'https://thebeacon.film';

// Which indexes to read, and which of their sections to accept.
//
// /series is the curated index and is small, so all of it is taken. /programs
// carries 40+ finished programs whose films are never on the current calendar —
// scraping them was measured to add nothing to tag coverage while costing several
// minutes per run — so only what is still running is taken from there.
const INDEXES = [
    { path: '/series', sections: null },
    { path: '/programs', sections: /now playing/i }
];

/**
 * Normalizes a series URL for comparison against the sheet.
 * Legacy /programs/entry/ paths now only serve a 308 redirect, so they must
 * collapse onto their current form or the same series looks like two entries.
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
    if (!url || typeof url !== 'string') {
        throw new Error('normalizeUrl: url must be a non-empty string');
    }
    return url.trim()
        .replace(/^(https:\/\/thebeacon\.film)\/programs\/entry\//, '$1/programs/')
        .replace(/\/+$/, '');
}

/**
 * Derives a seriesTag from a series URL.
 * The trailing slug is stable, unique per series, and already URL-safe.
 * @param {string} href
 * @returns {string}
 */
function tagFromHref(href) {
    if (!href || typeof href !== 'string') {
        throw new Error('tagFromHref: href must be a non-empty string');
    }
    return href.replace(/\/+$/, '').split('/').pop();
}

/**
 * Reads one index page and returns the entries in its accepted sections.
 * @param {Object} page - Puppeteer page
 * @param {{path: string, sections: RegExp|null}} index
 * @returns {Promise<Array<{seriesName: string, seriesURL: string, seriesTag: string, section: string}>>}
 */
async function discoverFromIndex(page, index) {
    const response = await navigateWithRetry(page, SITE + index.path, { logger });
    if (!response) {
        logger.error(`Failed to load ${index.path} after retries`);
        return [];
    }
    const status = typeof response.status === 'function' ? response.status() : 200;
    if (status >= 400) {
        logger.error(`${index.path} returned HTTP ${status}; skipping this index.`);
        return [];
    }

    const cards = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('.listing-section').forEach(section => {
            const heading = section.querySelector('.section-heading-brush')?.textContent.trim() || '';
            section.querySelectorAll('a.card').forEach(card => {
                const href = card.getAttribute('href');
                const title = card.querySelector('.card-title')?.textContent.trim() || '';
                if (href && title) out.push({ href, title, section: heading });
            });
        });
        return out;
    });

    if (cards.length === 0) {
        logger.warn(`No entries found on ${index.path}. The website structure may have changed.`);
        return [];
    }

    const accepted = index.sections
        ? cards.filter(card => index.sections.test(card.section))
        : cards;

    logger.info(`${index.path}: ${cards.length} entries, ${accepted.length} accepted` +
        (index.sections ? ' (currently running only)' : ''));

    return accepted.map(card => ({
        seriesName: card.title,
        seriesURL: SITE + card.href,
        seriesTag: tagFromHref(card.href),
        section: card.section
    }));
}

(async () => {
    logger.info('Starting discoverSeries.js');

    const existingRaw = await getSheetRows('seriesIndex');
    const header = existingRaw[0] && existingRaw[0].length
        ? existingRaw[0]
        : ['seriesName', 'seriesURL', 'seriesTag'];
    const iName = header.indexOf('seriesName');
    const iUrl = header.indexOf('seriesURL');
    const iTag = header.indexOf('seriesTag');
    if (iName === -1 || iUrl === -1 || iTag === -1) {
        logger.error(`seriesIndex header is missing required columns. Found: ${JSON.stringify(header)}`);
        process.exit(1);
    }

    const existingRows = existingRaw.slice(1).filter(row => row[iUrl] && row[iTag]);
    // Matching on URL rather than tag keeps the sheet's own seriesTag values
    // authoritative — they are short and hand-picked, unlike a derived slug.
    const knownUrls = new Set(existingRows.map(row => normalizeUrl(row[iUrl])));
    const knownTags = new Set(existingRows.map(row => row[iTag].trim()));
    logger.info(`seriesIndex currently holds ${existingRows.length} series.`);

    let browser;
    let added = 0;
    try {
        browser = await launchPuppeteerQuiet();
        const page = await browser.newPage();

        const discovered = [];
        for (const index of INDEXES) {
            discovered.push(...await discoverFromIndex(page, index));
        }
        logger.info(`Discovered ${discovered.length} series across ${INDEXES.length} indexes.`);

        const newRows = [];
        for (const entry of discovered) {
            if (knownUrls.has(normalizeUrl(entry.seriesURL))) {
                logger.info(`Already tracked, leaving as-is: ${entry.seriesTag}`);
                continue;
            }
            // A slug collision against a different URL would silently merge two
            // series under one tag, so suffix it rather than overwrite.
            let tag = entry.seriesTag;
            if (knownTags.has(tag)) {
                let suffix = 2;
                while (knownTags.has(`${tag}-${suffix}`)) suffix++;
                logger.warn(`seriesTag '${tag}' already used by a different URL; using '${tag}-${suffix}'.`);
                tag = `${tag}-${suffix}`;
            }

            const candidate = { seriesName: entry.seriesName, seriesURL: entry.seriesURL, seriesTag: tag };
            const { isValid, errors } = validateSeriesIndexRow(candidate);
            if (!isValid) {
                logger.warn(`Skipping invalid discovered series '${entry.seriesName}': ${errors.join('; ')}`);
                continue;
            }

            knownUrls.add(normalizeUrl(entry.seriesURL));
            knownTags.add(tag);
            newRows.push(candidate);
            logger.info(`New series: ${tag} [${entry.section}] -> ${entry.seriesURL}`);
        }

        added = newRows.length;
        if (added === 0) {
            logger.info('No new series to add. seriesIndex left unchanged.');
        } else {
            const rows = [header];
            for (const row of existingRows) rows.push(row);
            for (const row of newRows) {
                const out = new Array(header.length).fill('');
                out[iName] = row.seriesName;
                out[iUrl] = row.seriesURL;
                out[iTag] = row.seriesTag;
                rows.push(out);
            }
            await setSheetRows('seriesIndex', rows);
            logger.info(`seriesIndex updated: ${added} added, ${existingRows.length} kept, ${rows.length - 1} total.`);
        }
    } catch (error) {
        handleError(logger, error instanceof Error ? error : new Error(String(error)), 'Error discovering series');
    } finally {
        if (browser) await browser.close();
        logger.info(`discoverSeries.js finished. Series added: ${added}`);
    }
})().catch(err => {
    logger.error('Unhandled exception in discoverSeries.js:', err);
});

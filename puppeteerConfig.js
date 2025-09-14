/**
 * puppeteerConfig.js - Centralized Puppeteer configuration for Render.com
 * This module provides a consistent Puppeteer launch configuration across all scripts
 */

const puppeteer = require('puppeteer');
const fs = require('fs');

/**
 * Get the best Puppeteer launch configuration for the current environment
 * @returns {Object} Puppeteer launch options
 */
function getPuppeteerConfig() {
    const isRender = process.env.RENDER || process.platform === 'linux';
    
    const config = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-extensions',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ]
    };

    // Try to find Chrome executable in common Render locations
    if (isRender) {
        const possiblePaths = [
            '/opt/render/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome',
            '/opt/render/.cache/puppeteer/chrome/linux-*/chrome-linux/chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome'
        ];

        for (const path of possiblePaths) {
            if (path.includes('*')) {
                // Handle glob patterns for versioned directories
                const glob = require('glob');
                try {
                    const matches = glob.sync(path);
                    if (matches.length > 0 && fs.existsSync(matches[0])) {
                        config.executablePath = matches[0];
                        break;
                    }
                } catch (err) {
                    // glob might not be available, continue
                }
            } else if (fs.existsSync(path)) {
                config.executablePath = path;
                break;
            }
        }
    }

    return config;
}

/**
 * Launch Puppeteer with the best configuration for the current environment
 * @returns {Promise} Puppeteer browser instance
 */
async function launchPuppeteer() {
    const config = getPuppeteerConfig();
    console.log('Launching Puppeteer with config:', JSON.stringify(config, null, 2));
    return await puppeteer.launch(config);
}

module.exports = {
    getPuppeteerConfig,
    launchPuppeteer
};
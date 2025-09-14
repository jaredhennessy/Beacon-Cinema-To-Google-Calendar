/**
 * puppeteerConfig.js - Centralized Puppeteer configuration for Render.com
 * This module provides a consistent Puppeteer launch configuration across all scripts
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Ensure Chrome is installed for Puppeteer
 * @param {boolean} verbose - Whether to log detailed information
 * @returns {Promise<void>}
 */
async function ensureChromeInstalled(verbose = false) {
    const cacheDir = process.env.PUPPETEER_CACHE_DIR || 
        (process.platform === 'win32' ? 
            path.join(process.cwd(), '.cache', 'puppeteer') : 
            '/opt/render/.cache/puppeteer');
    
    // Check if Chrome is already installed
    if (fs.existsSync(cacheDir)) {
        try {
            const contents = fs.readdirSync(cacheDir, { recursive: true });
            const chromeExists = contents.some(file => 
                typeof file === 'string' && 
                (file.includes('chrome') || file.includes('chromium'))
            );
            
            if (chromeExists) {
                if (verbose) console.log('✓ Chrome installation verified');
                return;
            }
        } catch (err) {
            if (verbose) console.log('Error checking cache directory:', err.message);
        }
    }
    
    // Install Chrome if not found
    console.log('Chrome not found, installing...');
    try {
        // Create cache directory (cross-platform)
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        
        // Install Chrome with cross-platform command
        const installCmd = process.platform === 'win32' 
            ? `npx puppeteer browsers install chrome --path "${cacheDir}"`
            : `PUPPETEER_CACHE_DIR=${cacheDir} npx puppeteer browsers install chrome`;
            
        if (verbose) console.log('Running:', installCmd);
        
        execSync(installCmd, { 
            stdio: verbose ? 'inherit' : 'pipe',
            timeout: 120000, // 2 minutes timeout
            env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir }
        });
        
        console.log('✓ Chrome installation completed');
    } catch (error) {
        console.error('✗ Failed to install Chrome:', error.message);
        
        // Don't throw on non-Linux platforms for testing
        if (process.platform === 'linux') {
            throw error;
        } else {
            console.log('Continuing without runtime installation (development environment)');
        }
    }
}

/**
 * Get the best Puppeteer launch configuration for the current environment
 * @param {boolean} verbose - Whether to log detailed information
 * @returns {Object} Puppeteer launch options
 */
function getPuppeteerConfig(verbose = false) {
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
        const cacheDir = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';
        const possiblePaths = [
            `${cacheDir}/chrome/linux-*/chrome-linux64/chrome`,
            `${cacheDir}/chrome/linux-*/chrome-linux/chrome`,
            '/usr/bin/chromium-browser',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/google-chrome'
        ];

        for (const path of possiblePaths) {
            if (path.includes('*')) {
                // Handle glob patterns for versioned directories
                try {
                    const glob = require('glob');
                    const matches = glob.sync(path);
                    if (matches.length > 0 && fs.existsSync(matches[0])) {
                        config.executablePath = matches[0];
                        if (verbose) console.log(`Found Chrome at: ${matches[0]}`);
                        break;
                    }
                } catch (err) {
                    // glob might not be available, continue
                    if (verbose) console.log('Glob not available, trying manual path search');
                }
            } else if (fs.existsSync(path)) {
                config.executablePath = path;
                if (verbose) console.log(`Found Chrome at: ${path}`);
                break;
            }
        }
    }

    return config;
}

/**
 * Launch Puppeteer with the best configuration for the current environment
 * @param {boolean} verbose - Whether to log detailed information (default: false)
 * @returns {Promise} Puppeteer browser instance
 */
async function launchPuppeteer(verbose = false) {
    // Check for environment variable to enable verbose logging
    const isVerbose = verbose || process.env.PUPPETEER_VERBOSE === 'true';
    
    // Ensure Chrome is installed first
    await ensureChromeInstalled(isVerbose);
    
    const config = getPuppeteerConfig(isVerbose);
    
    if (isVerbose) {
        console.log('Launching Puppeteer with config:', JSON.stringify(config, null, 2));
    } else {
        console.log('🚀 Launching Puppeteer...');
    }
    
    return await puppeteer.launch(config);
}

/**
 * Launch Puppeteer quietly (minimal logging)
 * @returns {Promise} Puppeteer browser instance
 */
async function launchPuppeteerQuiet() {
    return await launchPuppeteer(false);
}

module.exports = {
    getPuppeteerConfig,
    launchPuppeteer,
    launchPuppeteerQuiet,
    ensureChromeInstalled
};
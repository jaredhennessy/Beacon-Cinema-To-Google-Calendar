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
 * @returns {Promise<void>}
 */
async function ensureChromeInstalled() {
    const cacheDir = process.env.PUPPETEER_CACHE_DIR || 
        (process.platform === 'win32' ? 
            path.join(process.cwd(), '.cache', 'puppeteer') : 
            '/opt/render/.cache/puppeteer');
    
    console.log(`Checking Chrome installation in: ${cacheDir}`);
    
    // Check if Chrome is already installed
    if (fs.existsSync(cacheDir)) {
        try {
            const contents = fs.readdirSync(cacheDir, { recursive: true });
            const chromeExists = contents.some(file => 
                typeof file === 'string' && 
                (file.includes('chrome') || file.includes('chromium'))
            );
            
            if (chromeExists) {
                console.log('Chrome installation found in cache directory');
                return;
            }
        } catch (err) {
            console.log('Error checking cache directory:', err.message);
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
            
        console.log('Running:', installCmd);
        
        execSync(installCmd, { 
            stdio: 'inherit',
            timeout: 120000, // 2 minutes timeout
            env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir }
        });
        
        console.log('Chrome installation completed');
    } catch (error) {
        console.error('Failed to install Chrome:', error.message);
        
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
                        console.log(`Found Chrome at: ${matches[0]}`);
                        break;
                    }
                } catch (err) {
                    // glob might not be available, continue
                    console.log('Glob not available, trying manual path search');
                }
            } else if (fs.existsSync(path)) {
                config.executablePath = path;
                console.log(`Found Chrome at: ${path}`);
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
    // Ensure Chrome is installed first
    await ensureChromeInstalled();
    
    const config = getPuppeteerConfig();
    console.log('Launching Puppeteer with config:', JSON.stringify(config, null, 2));
    return await puppeteer.launch(config);
}

module.exports = {
    getPuppeteerConfig,
    launchPuppeteer,
    ensureChromeInstalled
};
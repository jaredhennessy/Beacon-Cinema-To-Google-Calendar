/**
 * testPuppeteer.js - Simple Puppeteer test for Render.com debugging
 * Usage: node testPuppeteer.js
 * This script helps verify that Puppeteer can launch Chrome correctly on Render.com
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

console.log('=== Puppeteer Test for Render.com ===');
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
console.log('Architecture:', process.arch);

// Log environment variables
console.log('\n=== Environment Variables ===');
console.log('PUPPETEER_CACHE_DIR:', process.env.PUPPETEER_CACHE_DIR);
console.log('PUPPETEER_SKIP_CHROMIUM_DOWNLOAD:', process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD);
console.log('PUPPETEER_EXECUTABLE_PATH:', process.env.PUPPETEER_EXECUTABLE_PATH);

// Check cache directory
console.log('\n=== Cache Directory Check ===');
const cacheDir = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';
console.log('Checking cache directory:', cacheDir);

if (fs.existsSync(cacheDir)) {
    console.log('✓ Cache directory exists');
    try {
        const contents = fs.readdirSync(cacheDir, { recursive: true });
        console.log('Cache directory contents:', contents.slice(0, 10)); // Show first 10 items
    } catch (err) {
        console.log('✗ Could not read cache directory:', err.message);
    }
} else {
    console.log('✗ Cache directory does not exist');
}

// Test Puppeteer launch
console.log('\n=== Puppeteer Launch Test ===');
(async () => {
    let browser;
    try {
        console.log('Attempting to launch Puppeteer...');
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-first-run',
                '--no-zygote',
                '--single-process'
            ]
        });
        
        console.log('✓ Puppeteer launched successfully!');
        
        const page = await browser.newPage();
        await page.goto('https://example.com');
        const title = await page.title();
        console.log('✓ Successfully navigated to page. Title:', title);
        
        await browser.close();
        console.log('✓ Browser closed successfully');
        console.log('\n=== Test completed successfully! ===');
        
    } catch (error) {
        console.error('✗ Puppeteer launch failed:', error.message);
        console.error('Full error:', error);
        
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('Error closing browser:', closeError.message);
            }
        }
        
        process.exit(1);
    }
})();
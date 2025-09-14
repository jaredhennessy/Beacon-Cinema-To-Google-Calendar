/**
 * test-quiet-puppeteer.js - Quick test to demonstrate quiet Puppeteer logging
 */

const { launchPuppeteerQuiet, launchPuppeteer } = require('./puppeteerConfig');

console.log('=== Testing Quiet Puppeteer Launch ===');

(async () => {
    try {
        console.log('\n--- Quiet Mode (Production) ---');
        const browser1 = await launchPuppeteerQuiet();
        console.log('✓ Browser launched successfully (quiet mode)');
        await browser1.close();
        
        console.log('\n--- Verbose Mode (Debug) ---');
        const browser2 = await launchPuppeteer(true);
        console.log('✓ Browser launched successfully (verbose mode)');
        await browser2.close();
        
        console.log('\n✅ Test completed successfully');
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
})();
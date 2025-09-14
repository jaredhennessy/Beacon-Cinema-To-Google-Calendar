# Puppeteer Configuration for Render.com Deployment

This document outlines the complete solution for deploying Puppeteer applications on Render.com to resolve the "Could not find Chrome" error.

## Problem

When deploying Puppeteer applications to Render.com, you may encounter:

```text
Error: Could not find Chrome (ver. 135.0.7049.84)
```

## Solution Overview

The solution involves three key components:

### 1. Build-Time Chrome Installation (`render.yaml`)

```yaml
services:
  - type: web
    name: jcal-service
    env: node
    plan: free
    buildCommand: npm install && npx puppeteer browsers install chrome --path /opt/render/.cache/puppeteer
    startCommand: node webserver.js
    envVars:
      - key: PUPPETEER_CACHE_DIR
        value: /opt/render/.cache/puppeteer
      - key: PUPPETEER_SKIP_CHROMIUM_DOWNLOAD
        value: false
```

### 2. Runtime Chrome Verification (`puppeteerConfig.js`)

A centralized configuration module that:

- Checks if Chrome is installed at runtime
- Installs Chrome if missing (fallback mechanism)
- Provides optimized launch arguments for Render.com
- Works cross-platform for local development
- **Minimal logging by default** for cleaner production output

Key functions:

- `ensureChromeInstalled()` - Verifies/installs Chrome
- `getPuppeteerConfig()` - Returns optimized launch configuration
- `launchPuppeteer(verbose)` - Combines installation check + launch with optional verbose logging
- `launchPuppeteerQuiet()` - Quiet launch (minimal logging, recommended for production)

### 3. Updated Application Scripts

All Puppeteer scripts now use the centralized configuration:

- `beaconSeries.js`
- `beaconSchedule.js`
- `findRuntimes.js`

## Implementation Details

### Environment Variables

- `PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer` - Chrome installation location
- `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false` - Allow Chrome download
- `PUPPETEER_VERBOSE=true` - Enable verbose logging (optional, for debugging)

### Logging Control

**Production (Default)**: Minimal logging with simple status messages

```bash
🚀 Launching Puppeteer...
```

**Debug Mode**: Enable verbose logging when needed

```bash
# Set environment variable for detailed logging
export PUPPETEER_VERBOSE=true
# Or call launchPuppeteer(true) directly in code
```

### Chrome Launch Arguments

Optimized for Render.com's container environment:

```javascript
{
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
}
```

## Testing

Use `testPuppeteer.js` to verify the configuration:

```bash
node testPuppeteer.js
```

This script:

- Checks environment variables
- Verifies Chrome installation
- Tests Puppeteer launch
- Validates page navigation

## Migration Steps

1. Update `render.yaml` with Chrome installation buildCommand
2. Add environment variables to render.yaml
3. Create `puppeteerConfig.js` module
4. Update all Puppeteer scripts to use `launchPuppeteer()`
5. Test locally with `testPuppeteer.js`
6. Deploy to Render.com

## Benefits

- **Reliable Chrome availability** on Render.com
- **Cross-platform compatibility** for development
- **Centralized configuration** for consistency
- **Runtime fallback** if build-time installation fails
- **Optimized performance** for container environments

## Troubleshooting

If you still encounter Chrome issues:

1. Check Render.com build logs for Chrome installation
2. Verify environment variables are set correctly
3. Run `testPuppeteer.js` to diagnose the issue
4. Ensure your scripts use `launchPuppeteer()` from puppeteerConfig

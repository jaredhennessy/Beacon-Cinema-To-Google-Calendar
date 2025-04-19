const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path'); // Use path for relative paths
const { execSync } = require('child_process'); // Import child_process to execute scripts
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

(async () => {
    // Execute beaconSeries.js
    try {
        console.log('Executing beaconSeries.js...');
        execSync('node ./beaconSeries.js', { stdio: 'inherit' }); // Use relative path
        console.log('beaconSeries.js executed successfully.');
    } catch (error) {
        console.error('Error executing beaconSeries.js:', error.message);
        return; // Exit if beaconSeries.js fails
    }

    const calendarUrl = 'https://thebeacon.film/calendar';
    const seriesCsvPath = path.join(__dirname, 'files', 'series.csv');
    const scheduleCsvPath = path.join(__dirname, 'files', 'schedule.csv');

    const scheduleCsvWriter = createCsvWriter({
        path: scheduleCsvPath,
        header: [
            { id: 'title', title: 'Title' },
            { id: 'date', title: 'Date' },
            { id: 'time', title: 'Time' },
            { id: 'url', title: 'URL' },
            { id: 'seriesTag', title: 'SeriesTag' },
            { id: 'dateRecorded', title: 'DateRecorded' }
        ]
    });

    const normalizeTitle = title => title.replace(/^"|"$/g, '').trim().toLowerCase(); // Helper function to normalize titles

    let browser;
    try {
        browser = await puppeteer.launch();
        const page = await browser.newPage();

        // Extract unique titles from the website
        await page.goto(calendarUrl, { waitUntil: 'networkidle2' });
        const titles = await page.evaluate(() => {
            const titleElements = document.querySelectorAll('section[itemprop="name"]');
            const titles = Array.from(titleElements).map(el => el.textContent.trim());
            return [...new Set(titles)]; // Remove duplicates
        });

        // Extract unique titles from the website and preserve original formatting
        const titleMap = new Map(
            titles.map(title => [normalizeTitle(title), title.trim()]) // Map normalized title to original title
        );

        // Filter out "RENT THE BEACON"
        titleMap.delete(normalizeTitle('RENT THE BEACON'));

        // Read series.csv into a map for quick lookup
        const seriesMap = new Map(
            fs.readFileSync(seriesCsvPath, 'utf8')
                .split('\n')
                .slice(1) // Skip the header row
                .map(line => line.split(',').map(field => field.trim())) // Split and trim fields
                .filter(fields => fields.length === 2) // Ensure valid rows
                .map(([title, seriesTag]) => [normalizeTitle(title), seriesTag]) // Map normalized title to seriesTag
        );

        console.log('Extracted titles:', Array.from(titleMap.values()));

        // Extract schedule data from the website
        const schedule = await page.evaluate(() => {
            const scheduleList = [];

            // Find all event blocks on the page
            const eventBlocks = document.querySelectorAll('section[itemprop="name"]');
            if (eventBlocks.length === 0) {
                console.warn('No event blocks found. The website structure may have changed.');
            }
            eventBlocks.forEach(eventBlock => {
                const title = eventBlock.textContent.trim();
                const url = eventBlock.closest('a')?.href || '';

                // Find all sibling sections with class="time" and itemprop="startDate"
                const timeElements = Array.from(eventBlock.parentElement.querySelectorAll('section.time[itemprop="startDate"]'));
                timeElements.forEach(timeElement => {
                    const startDate = timeElement.getAttribute('content');
                    if (startDate) {
                        const [date, time] = startDate.split('T'); // Split ISO date-time format into date and time
                        const formattedDate = date; // Use ISO format yyyy-mm-dd directly
                        const formattedTime = time.slice(0, 5); // Extract HH:MM from ISO time

                        scheduleList.push({ title, date: formattedDate, time: formattedTime, url });
                    }
                });
            });

            return scheduleList;
        });

        // Remove records from schedule.csv where the start date is >= today's date
        const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
        const existingSchedule = fs.existsSync(scheduleCsvPath)
            ? fs.readFileSync(scheduleCsvPath, 'utf8')
                  .split('\n')
                  .slice(1) // Skip the header row
                  .map(line => line.split(',').map(field => field.trim())) // Split and trim fields
                  .filter(fields => fields.length >= 2) // Ensure valid rows
            : [];

        const filteredSchedule = existingSchedule.filter(([title, date]) => date < today); // Keep rows with dates < today

        const tempScheduleCsvWriter = createCsvWriter({
            path: scheduleCsvPath,
            header: [
                { id: 'title', title: 'Title' },
                { id: 'date', title: 'Date' },
                { id: 'time', title: 'Time' },
                { id: 'url', title: 'URL' },
                { id: 'seriesTag', title: 'SeriesTag' },
                { id: 'dateRecorded', title: 'DateRecorded' }
            ]
        });

        await tempScheduleCsvWriter.writeRecords(
            filteredSchedule.map(([title, date, time, url, seriesTag, dateRecorded]) => ({
                title,
                date,
                time,
                url,
                seriesTag,
                dateRecorded
            }))
        );

        console.log('Removed future screenings from schedule.csv.');

        // Add seriesTag and dateRecorded fields to schedule, skipping "RENT THE BEACON"
        const currentTimestamp = new Date().toISOString();
        const scheduleWithSeriesTag = schedule
            .filter(event => event.title !== 'RENT THE BEACON') // Skip records where Title is "RENT THE BEACON"
            .map(event => ({
                ...event,
                seriesTag: event.title === '?????? CINEMA'
                    ? 'secret'
                    : seriesMap.get(normalizeTitle(event.title)) || '', // Use "secret" for "?????? CINEMA", otherwise lookup or blank
                dateRecorded: currentTimestamp // Populate with the current timestamp
            }));

        // Write the final schedule to schedule.csv
        await scheduleCsvWriter.writeRecords(
            scheduleWithSeriesTag.map(event => ({
                ...event,
                title: titleMap.get(normalizeTitle(event.title)) || event.title // Preserve original formatting
            }))
        );

        console.log('schedule.csv written successfully.');
    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
})();
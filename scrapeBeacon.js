const puppeteer = require('puppeteer');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

(async () => {
    const calendarUrl = 'https://thebeacon.film/calendar';
    const lynchianCsvPath = 'lynchian.csv';
    const filmsCsvPath = 'films.csv';
    const scheduleCsvPath = 'schedule.csv';

    const filmsCsvWriter = createCsvWriter({
        path: filmsCsvPath,
        header: [{ id: 'title', title: 'Title' }],
        append: true // Append new records instead of overwriting
    });

    const scheduleCsvWriter = createCsvWriter({
        path: scheduleCsvPath,
        header: [
            { id: 'title', title: 'Title' },
            { id: 'date', title: 'Date' },
            { id: 'time', title: 'Time' },
            { id: 'url', title: 'URL' },
            { id: 'lynchian', title: 'Lynchian' }
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

        // Read existing titles from films.csv into a set and normalize them
        const existingTitles = new Set(
            fs.existsSync(filmsCsvPath)
                ? fs.readFileSync(filmsCsvPath, 'utf8')
                      .split('\n')
                      .slice(1) // Skip the header row
                      .map(line => normalizeTitle(line)) // Normalize titles
                      .filter(line => line)
                : []
        );

        // Filter out titles that are already in films.csv
        const newTitles = Array.from(titleMap.keys()).filter(title => !existingTitles.has(title));

        // Write only new titles to films.csv, preserving original formatting
        const filmsRecords = newTitles.map(title => ({ title: titleMap.get(title) })); // Preserve original formatting
        if (filmsRecords.length > 0) {
            await filmsCsvWriter.writeRecords(filmsRecords);
            console.log('New titles added to films.csv:', filmsRecords.map(record => record.title));
        } else {
            console.log('No new titles to add to films.csv.');
        }

        // Read lynchian.csv into a set for quick lookup
        const lynchianSet = new Set(
            fs.readFileSync(lynchianCsvPath, 'utf8')
                .split('\n')
                .slice(1) // Skip the header row
                .map(line => normalizeTitle(line)) // Normalize titles
                .filter(line => line) // Remove empty lines
        );

        // Read films.csv into a set for filtering schedule data
        const filmsSet = new Set(
            fs.readFileSync(filmsCsvPath, 'utf8')
                .split('\n')
                .slice(1)
                .map(line => normalizeTitle(line)) // Normalize titles
                .filter(line => line)
        );

        console.log('Titles in filmsSet:', Array.from(filmsSet));

        // Read existing schedule.csv and filter out rows with dates >= today
        const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
        const existingSchedule = fs.existsSync(scheduleCsvPath)
            ? fs.readFileSync(scheduleCsvPath, 'utf8')
                  .split('\n')
                  .slice(1) // Skip the header row
                  .map(row => row.split(',')) // Parse CSV rows
                  .filter(row => row[1] < today) // Keep rows with dates < today
            : [];

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

        console.log('Extracted schedule:', schedule);

        // Filter schedule data to only include titles in films.csv and dates >= today
        const filteredSchedule = schedule.filter(event =>
            filmsSet.has(normalizeTitle(event.title)) && event.date >= today
        );

        console.log('Filtered schedule:', filteredSchedule);

        // Add debugging logs to confirm normalized titles
        filteredSchedule.forEach(event => {
            console.log('Normalized title from website:', normalizeTitle(event.title));
            console.log('Normalized title in filmsSet:', Array.from(filmsSet));
        });

        // Add Lynchian field to schedule
        const scheduleWithLynchian = filteredSchedule.map(event => ({
            ...event,
            lynchian: lynchianSet.has(normalizeTitle(event.title)) ? 'Y' : 'N'
        }));

        // Write the final schedule to schedule.csv
        await scheduleCsvWriter.writeRecords(
            scheduleWithLynchian.map(event => ({
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
// webserver.js
// Express server to run scripts and stream logs to the browser

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const { getLogStats, rotateLogs, cleanupLogs, maintainLogs } = require('./logManager');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const scripts = [
  'fullUpdate.js',
  'beaconSeries.js',
  'beaconSchedule.js',
  'findRuntimes.js',
  'updateGCal.js',
  'testPuppeteer.js'
];

app.get('/api/run/:script', (req, res) => {
  const script = req.params.script;
  if (!scripts.includes(script)) {
    return res.status(400).send('Invalid script');
  }
  
  const proc = spawn('node', [script], { cwd: __dirname });
  
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Transfer-Encoding': 'chunked'
  });
  
  proc.stdout.on('data', data => res.write(data));
  proc.stderr.on('data', data => res.write(data));
  
  proc.on('close', code => {
    res.end(`\n[Process exited with code ${code}]`);
  });
});

app.get('/api/logs/:command', (req, res) => {
  const command = req.params.command;
  const validCommands = ['stats', 'rotate', 'cleanup', 'maintain'];
  
  if (!validCommands.includes(command)) {
    return res.status(400).send('Invalid log command');
  }
  
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Transfer-Encoding': 'chunked'
  });
  
  try {
    let result;
    switch (command) {
      case 'stats':
        result = getLogStats();
        res.write(`Log File Statistics:\n`);
        res.write(`Total Files: ${result.totalFiles}\n`);
        res.write(`Total Size: ${result.totalSizeMB}MB\n\n`);
        res.write(`Files:\n`);
        result.files.forEach(file => {
          res.write(`  ${file.name}: ${file.sizeMB}MB (${file.ageHours}h old)\n`);
        });
        break;
        
      case 'rotate':
        result = rotateLogs();
        res.write(`Rotated ${result.rotated} log files\n`);
        if (result.errors.length > 0) {
          res.write(`Errors: ${JSON.stringify(result.errors, null, 2)}\n`);
        }
        break;
        
      case 'cleanup':
        result = cleanupLogs();
        res.write(`Deleted ${result.deleted} old log files\n`);
        if (result.errors.length > 0) {
          res.write(`Errors: ${JSON.stringify(result.errors, null, 2)}\n`);
        }
        break;
        
      case 'maintain':
        result = maintainLogs();
        res.write(`Log maintenance completed:\n`);
        res.write(`  Rotated: ${result.rotated} files\n`);
        res.write(`  Compressed: ${result.compressed} files\n`);
        res.write(`  Deleted: ${result.deleted} files\n`);
        res.write(`  Size reduction: ${result.initial.totalSizeMB}MB -> ${result.final.totalSizeMB}MB\n`);
        break;
    }
    
    res.end('\n[Log operation completed]');
  } catch (error) {
    res.write(`Error: ${error.message}\n`);
    res.end('\n[Log operation failed]');
  }
});

app.listen(PORT, () => {
  console.log(`Web server running at http://localhost:${PORT}`);
});

// webserver.js
// Express server to run scripts and stream their output to the browser.
//
// A run is streamed as Server-Sent Events rather than plain text. text/event-stream carries
// explicit do-not-buffer semantics that reverse proxies honour, whereas text/plain is readily
// buffered — which is why output appeared only after a run finished when deployed behind
// Render's proxy, despite streaming correctly against a local client.
//
// The log management endpoints stay plain text; only the run endpoint is SSE.

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const { getLogStats, rotateLogs, cleanupLogs, maintainLogs } = require('./logManager');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Interval for keepalive comments while a child produces no output. Comments are not content,
// but they keep bytes moving, which defeats byte-threshold buffering and lets the browser show
// that the run is still alive.
const HEARTBEAT_MS = 10000;

const scripts = [
  'fullUpdate.js',
  'discoverSeries.js',
  'beaconSeries.js',
  'beaconSchedule.js',
  'findRuntimes.js',
  'updateGCal.js',
  'testPuppeteer.js'
];

// The run in progress. Only one at a time: two concurrent pipelines mean two Chrome instances,
// which exhausts a small instance's memory.
let activeRun = null;

app.get('/api/run/:script', (req, res) => {
  const script = req.params.script;
  if (!scripts.includes(script)) {
    return res.status(400).send('Invalid script');
  }
  if (activeRun) {
    return res.status(409).send(`${activeRun} is already running. Wait for it to finish.`);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    // no-transform tells intermediaries not to buffer in order to re-encode.
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    // Understood by nginx-family proxies as "stream this through untouched".
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff'
  });
  // Nagle would hold back the small writes this endpoint produces.
  if (res.socket) res.socket.setNoDelay(true);
  res.flushHeaders();

  const startedAt = Date.now();
  const elapsed = () => ((Date.now() - startedAt) / 1000).toFixed(0);

  let open = true;
  const send = text => {
    if (!open) return;
    // One data: line per output line, so a newline inside the payload cannot break framing.
    res.write(text.split('\n').map(line => `data: ${line}\n`).join('') + '\n');
  };
  const comment = text => {
    if (open) res.write(`: ${text}\n\n`);
  };

  // Gets headers and first bytes onto the wire before the child produces anything, so the
  // browser's fetch resolves immediately rather than waiting on a proxy to commit.
  send(`Running ${script}...`);

  const heartbeat = setInterval(() => comment(`ping ${elapsed()}s`), HEARTBEAT_MS);

  const child = spawn(process.execPath, [path.join(__dirname, script)], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  activeRun = script;

  // Child output arrives in arbitrary chunks, so hold back a partial trailing line.
  let pending = '';
  const onChunk = chunk => {
    pending += chunk.toString();
    let i;
    while ((i = pending.indexOf('\n')) >= 0) {
      send(pending.slice(0, i).replace(/\r$/, ''));
      pending = pending.slice(i + 1);
    }
  };
  child.stdout.on('data', onChunk);
  child.stderr.on('data', onChunk);

  const finish = summary => {
    clearInterval(heartbeat);
    activeRun = null;
    if (pending) send(pending);
    send(summary);
    if (open) res.end();
  };

  // spawn emits this when the binary cannot be executed. Unhandled, it would throw and take
  // down the whole server rather than just this run.
  child.on('error', err => finish(`[Failed to start ${script}: ${err.message}]`));

  child.on('close', (code, signal) => {
    if (signal) {
      const hint = signal === 'SIGKILL'
        ? ' The host most likely ran out of memory; see the memory notes in README.md.'
        : '';
      finish(`[${script} was killed by ${signal}.${hint}]`);
    } else {
      finish(`[Process exited with code ${code}]`);
    }
  });

  // A closed tab must not abort the run. updateGCal.js deletes every upcoming event before
  // recreating them, so killing it midway would leave the calendar half rebuilt. Stop writing
  // and stop the heartbeat, but let the child finish and release the lock itself.
  res.on('close', () => {
    if (!open) return;
    open = false;
    clearInterval(heartbeat);
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

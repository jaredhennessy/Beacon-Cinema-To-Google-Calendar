// webserver.js
// Express server to run scripts and stream logs to the browser

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');

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
  proc.on('close', code => res.end(`\n[Process exited with code ${code}]`));
});

app.listen(PORT, () => {
  console.log(`Web server running at http://localhost:${PORT}`);
});

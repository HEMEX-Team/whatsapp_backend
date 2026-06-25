const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(process.cwd(), '.cursor/debug-a599f2.log');

function debugLog(location, message, data = {}, hypothesisId = '') {
  const entry = {
    sessionId: 'a599f2',
    location,
    message,
    data,
    hypothesisId,
    timestamp: Date.now(),
    runId: 'ws-debug',
  };

  try {
    fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`);
  } catch {
    /* ignore */
  }
}

module.exports = { debugLog };

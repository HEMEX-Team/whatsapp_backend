require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const chromium = require('chromium');
const { debugLog } = require('../utils/debugLog');

const deviceId = `diag-${Date.now()}`;
const CACHE_DIR = path.join(process.cwd(), 'wwebjs_cache');

const client = new Client({
  authStrategy: new LocalAuth({ clientId: deviceId, dataPath: CACHE_DIR }),
  puppeteer: {
    executablePath: process.env.CHROMIUM_PATH || chromium.path,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true,
  },
});

client.on('qr', (qr) => {
  debugLog('diag.js:qr', 'qr received', { deviceId, qrLen: qr?.length }, 'H-BE-QR');
  console.log('QR received, length', qr?.length);
  process.exit(0);
});

client.on('loading_screen', (pct, msg) => {
  debugLog('diag.js:loading', 'loading screen', { pct, msg }, 'H-BE-INIT');
  console.log('loading', pct, msg);
});

client.on('auth_failure', (msg) => {
  debugLog('diag.js:auth_failure', 'auth failure', { msg: String(msg) }, 'H-BE-INIT');
  console.error('auth_failure', msg);
  process.exit(1);
});

console.log('chromium', process.env.CHROMIUM_PATH || chromium.path);
console.log('initializing', deviceId);

const timeout = setTimeout(() => {
  debugLog('diag.js:timeout', 'no qr within 90s', { deviceId }, 'H-BE-INIT');
  console.error('TIMEOUT');
  process.exit(1);
}, 90000);

client
  .initialize()
  .then(() => {
    debugLog('diag.js:initialized', 'initialize resolved', { deviceId }, 'H-BE-INIT');
    console.log('initialize resolved (authenticated session?)');
  })
  .catch((err) => {
    clearTimeout(timeout);
    debugLog('diag.js:initError', 'initialize rejected', { error: err.message }, 'H-BE-INIT');
    console.error('init error', err);
    process.exit(1);
  });

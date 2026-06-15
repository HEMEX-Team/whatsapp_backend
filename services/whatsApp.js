require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const { saveMessage } = require('../services/whatapp-helper');
const { checkIsPrivateMessage, checkMedia } = require('../utils/messageUtils');
const { parsePhoneNumber } = require('../utils/phoneUtils');
const qrcode = require('qrcode-terminal');
const path = require('path');
const chromium = require('chromium');

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'whatsapp-agent',
        dataPath: path.join(process.cwd(), 'wwebjs_cache')
    }),
    takeoverOnConflict: true,
    takeoverTimeoutMs: 10000,
    puppeteer: {
        executablePath: process.env.CHROMIUM_PATH || chromium.path,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true
    }
});

let connectionState = 'UNLAUNCHED';
let isClientReady = false;
let isAuthenticated = false;
let loadingPercent = null;
let initPromise = null;

client.on('qr', (qr) => {
    console.log('QR Code:', qr);
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    isAuthenticated = true;
    console.log('WhatsApp authenticated');
});

client.on('loading_screen', (percent, message) => {
    loadingPercent = percent;
    console.log(`WhatsApp loading: ${percent}% - ${message}`);
});

client.on('auth_failure', (msg) => {
    console.error('WhatsApp auth failure:', msg);
});

client.on('disconnected', (reason) => {
    isClientReady = false;
    isAuthenticated = false;
    connectionState = reason;
    initPromise = null;
    console.log('WhatsApp disconnected:', reason);
});

client.on('ready', async () => {
    console.log('WhatsApp Web is ready');
    isClientReady = true;
});

// COMMENTED OUT FOR NOW AS WE ARE NOT DEPENDING ON DB TO FETCH CHATS

/*
client.on('message_create', async (message) => {
    try{
      if (!await checkIsPrivateMessage(message)){
        return;
      };

      let direction = message.fromMe ? 'outgoing' : 'incoming';
      let contactNumber;
      try {
        contactNumber = parsePhoneNumber(message.from);
      } catch(error) {
        console.error(error);
        return;
      }

      let mediaInfo = await checkMedia(message);
      await saveMessage({
        contactNumber,
        direction,
        body: message.body || '',
        media: mediaInfo && mediaInfo.media ? mediaInfo.media.data : null,
        mimeType: mediaInfo && mediaInfo.media ? mediaInfo.media.mimetype : null,
        timestamp: message.timestamp ? new Date(message.timestamp * 1000) : new Date(),
        ack: message.ack,
        message: message
      });
      console.log('Message saved')
    }catch (error) {
      console.error('Error saving message:', error);
    }
});
*/

async function initializeClient() {
    if (!initPromise) {
        initPromise = client.initialize().catch((err) => {
            initPromise = null;
            throw err;
        });
    }
    return initPromise;
}

async function destroyClient() {
    if (initPromise) {
        try {
            await client.destroy();
        } catch (err) {
            console.error('Error destroying WhatsApp client:', err);
        }
        initPromise = null;
        isClientReady = false;
        isAuthenticated = false;
    }
}

async function getConnectionStatus() {
    const hasPupPage = !!client.pupPage;
    let state = null;
    let authState = null;

    if (hasPupPage) {
        try {
            state = await client.getState();
            if (state) connectionState = state;

            authState = await client.pupPage.evaluate(() => {
                const appState = window.AuthStore?.AppState;
                return appState?.get?.('state') ?? appState?.state ?? null;
            });
            if (authState) connectionState = authState;
        } catch {
            state = connectionState || 'UNKNOWN';
        }
    }

    const effectiveState = state || authState || connectionState;
    const ready = isClientReady && hasPupPage;
    const sessionLinked = isAuthenticated && effectiveState === 'CONNECTED';
    const connected = ready;
    const needsQrScan = ['UNPAIRED', 'UNPAIRED_IDLE', 'PAIRING'].includes(effectiveState);

    let status = 'initializing';
    if (connected) status = 'connected';
    else if (sessionLinked) status = 'syncing';
    else if (isAuthenticated) status = 'connecting';
    else if (needsQrScan) status = 'qr_required';

    return {
        connected,
        sessionLinked,
        status,
        isReady: ready,
        isAuthenticated,
        isInitialized: hasPupPage,
        state: effectiveState,
        loadingPercent,
        needsQrScan,
    };
}

module.exports = {
    client,
    isReady: () => isClientReady && !!client.pupPage,
    initializeClient,
    destroyClient,
    getConnectionStatus,
};

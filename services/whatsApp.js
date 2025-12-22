require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const { saveMessage } = require('../services/whatapp-helper');
const { checkIsPrivateMessage, checkMedia } = require('../utils/messageUtils');
const { parsePhoneNumber } = require('../utils/phoneUtils');
const qrcode = require('qrcode-terminal');
const path = require('path');

// Create client instance
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'whatsapp-agent',
     	dataPath: path.join(process.cwd(), 'wwebjs_cache')
    }),
    puppeteer: {
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true
    }
});

client.on('qr', (qr) => {
    console.log('QR Code:', qr);
    qrcode.generate(qr, { small: true });
});

let isClientReady = false;

client.on('ready', async() => {
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
        message: message // Pass the full WhatsApp message object
      });
      console.log('Message saved')
    }catch (error) {
      console.error('Error saving message:', error);
    }
});
*/

// Export both client and ready state
module.exports = { 
    client,
    isReady: () => isClientReady && !!client.pupPage
};

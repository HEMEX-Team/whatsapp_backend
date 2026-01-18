const Chat = require('../models/Chat');
const { getChatId } = require('../utils/phoneUtils');


// Save a message (incoming or outgoing) to the chat collection
// @param {Object} params - Message parameters
// @param {string} params.contactNumber - Contact phone number
// @param {string} params.direction - Message direction ('incoming' or 'outgoing')
// @param {string} params.body - Message body
// @param {string} params.media - Media data
// @param {string} params.mimeType - MIME type
// @param {Date} params.timestamp - Message timestamp
// @param {number} params.ack - Acknowledgment status
// @param {Object} params.message - WhatsApp message object
// @param {Object} [params.client] - Optional WhatsApp client instance for label operations
async function saveMessage({ contactNumber, direction, body, media, mimeType, timestamp, ack, message: whatsappMessage, client = null }) {
  const message = { direction, body, media, mimeType, timestamp, ack };
  
  // Find or create chat
  let chat = await Chat.findOne({ contactNumber: contactNumber });
  
  if (!chat) {
    // Create new chat
    const chatData = {
      contactNumber: contactNumber,
      messages: [message],
      lastMessage: body || ""
    };

    // Add chatId if available from WhatsApp message
    if (whatsappMessage?.id) {
      chatData.chatId = whatsappMessage.id.id;
    }
    
    chat = new Chat(chatData);
    console.log('[saveMessage] Creating new chat document.');
    
    // Assign default label ID 38 to new chat if chatId is available and client is provided
    const chatId = getChatId(contactNumber)
    if (chatId && client) {
      try {
        await client.addOrRemoveLabels([chatId], ['38']);
        console.log(`[saveMessage] Assigned default label ID 38 to new chat ${chatId}`);
      } catch (error) {
        console.error('[saveMessage] Error assigning default label:', error);
      }
    }
  } else {
    // Update existing chat
    if (direction === 'incoming') {
      chat.lastMessage = body;
    } else if (direction === 'outgoing') {
      // If this is an outgoing message, mark as replied
      chat.hasReplied = true;
    }
    chat.messages.push(message);
    
    // Update chatId if not set and available
    if (!chat.chatId && whatsappMessage?.id) {
      chat.chatId = whatsappMessage.id.id;
    }
  }
  try {
    await chat.save();
    console.log('[saveMessage] Message saved successfully.');
  } catch (err) {
    console.error('[saveMessage] Error saving chat:', err);
  }
}
module.exports = { saveMessage };

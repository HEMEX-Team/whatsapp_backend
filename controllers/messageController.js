const { MessageMedia } = require("whatsapp-web.js");
const { parsePhoneNumber } = require("../utils/phoneUtils");
const fs = require("fs");
const {
  saveMessage: saveMessageService,
} = require("../services/whatapp-helper");
const { client } = require('../services/whatsApp');

// numbers must be in this format
// 201061261991
async function sendBulkMessage(req, res, client) {
  const { phoneNumbers, message } = req.body;

  const file = req.file;
  console.log(phoneNumbers)
  let phoneNumbersArray = phoneNumbers.split(",").map((num) => num.trim());
  if (!Array.isArray(phoneNumbersArray)) {
    phoneNumbersArray = [phoneNumbersArray]; // Convert single string to array
  }

  if (phoneNumbersArray.length === 0) {
    return res.status(400).send("Phone numbers must be a non-empty array.");
  }
  if (!message && !file) {
    return res
      .status(400)
      .send("At least one of message or media is required.");
  }
  try {
    let messageMedia = null;
    if (file) {
      messageMedia = MessageMedia.fromFilePath(file.path);
    }
    for (const phoneNumber of phoneNumbersArray) {
      let contactNumber;
      try {
        contactNumber = parsePhoneNumber(phoneNumber);
      } catch (err) {
        continue; // skip invalid numbers
      }
      const chatId = contactNumber.replace("+", "") + "@c.us";
      console.log(chatId);
      let sentMessage;
      if (messageMedia) {
        sentMessage = await client.sendMessage(chatId, messageMedia, {
          caption: message,
        });
      } else {
        console.log("sending message");
        sentMessage = await client.sendMessage(chatId, message);
      }
      // Generate random delay between 1-5 seconds (1000-5000ms)
      const randomDelay = Math.floor(Math.random() * 4000) + 1000;
      await new Promise((resolve) => setTimeout(resolve, randomDelay));
    }
    if (file) {
      fs.unlink(file.path, (err) => {
        if (err) console.error("Error deleting file:", err.message);
      });
    }
    return res
      .status(200)
      .json({ success: true, message: "Messages sent successfully" });
    // return res.status(200).send({ success: true, message: 'Messages sent successfully' });
  } catch (error) {
    console.error("Error sending bulk messages:", error.message);
    return res.status(500).send("Failed to send messages: " + error.message);
  }
}

async function sendMessage(req, res, client) {
  const { phoneNumber, message } = req.body;
  const file = req.file;

  if (!phoneNumber) {
    return res.status(400).send("Phone number is required.");
  }
  if (!message && !file) {
    return res
      .status(400)
      .send("At least one of message or media is required.");
  }

  try {
    let contactNumber;
    try {
      contactNumber = parsePhoneNumber(phoneNumber);
    } catch (err) {
      return res.status(400).send("Invalid phone number format.");
    }

    const chatId = contactNumber.replace("+", "") + "@c.us";
    let messageMedia = null;

    if (file) {
      messageMedia = MessageMedia.fromFilePath(file.path);
    }

    let sentMessage;
    if (messageMedia) {
      sentMessage = await client.sendMessage(chatId, messageMedia, {
        caption: message,
      });
    } else {
      sentMessage = await client.sendMessage(chatId, message);
    }

    // Save outgoing message to DB, including WhatsApp message id
    await saveMessageService({
      contactNumber: contactNumber,
      direction: "outgoing",
      body: message,
      media: messageMedia ? messageMedia.data : null,
      mimeType: messageMedia ? messageMedia.mimetype : null,
      timestamp: new Date(),
      ack: 1, // Sent to server
      waId: sentMessage.id && sentMessage.id.id ? sentMessage.id.id : undefined,
    });

    if (file) {
      fs.unlink(file.path, (err) => {
        if (err) console.error("Error deleting file:", err.message);
      });
    }

    return res
      .status(200)
      .send({ success: true, message: "Message sent successfully" });
  } catch (error) {
    console.error("Error sending message:", error.message);
    return res.status(500).send("Failed to send message: " + error.message);
  }
}

async function saveMessage(req, res) {
  try {
    const {
      phoneNumber,
      message,
      media,
      mimeType,
      messageTimestamp,
      direction,
      ack,
    } = req.body;
    if (!phoneNumber)
      return res.status(400).json({ error: "phoneNumber required" });
    // Validate phone number
    const formattedNumber = parsePhoneNumber(phoneNumber);
    await saveMessageService({
      contactNumber: formattedNumber,
      direction: direction || "incoming",
      body: message,
      media,
      mimeType,
      timestamp: messageTimestamp ? new Date(messageTimestamp) : new Date(),
      ack: typeof ack === "number" ? ack : undefined,
    });
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}


/**
 * Send bulk messages to all chats with a specific label ID
 * @param {Object} req - Express request object
 * @param {Object} req.body - Request body
 * @param {string} req.body.labelId - The label ID to filter chats
 * @param {string} req.body.message - The message to send
 * @param {Object} [req.file] - Optional media file
 * @param {Object} res - Express response object
 */
async function sendBulkToLabel(req, res) {
    const { labelId, message } = req.body;
    const file = req.file;
	
    if (!labelId) {
        return res.status(400).json({ success: false, message: 'Label ID is required' });
    }
    if (!message && !file) {
        return res.status(400).json({ success: false, message: 'At least one of message or media is required' });
    }

    try {
        // Get all chats with the specified label
        const chats = await client.getChats();
        const chatsWithLabel = [];
        // Filter chats that have the specified label
        for (const chat of chats) {
            const labels = await chat.getLabels();
          	//console.log(`first label ${labels[0].id} | ${labels[0].name}`)
            if (labels.some(label => label.id == labelId)) {
                chatsWithLabel.push(chat);
            }
        }

        if (chatsWithLabel.length === 0) {
            return res.status(404).json({ success: false, message: 'No chats found with the specified label' });
        }

        let messageMedia = null;
        if (file) {
            messageMedia = MessageMedia.fromFilePath(file.path);
        }

        const results = [];
        for (const chat of chatsWithLabel) {
            try {
                let sentMessage;
                if (messageMedia) {
                    sentMessage = await client.sendMessage(chat.id._serialized, messageMedia, { caption: message });
                } else {
                    sentMessage = await client.sendMessage(chat.id._serialized, message);
                }

                // Save outgoing message to DB
                await saveMessageService({
                    contactNumber: chat.id.user,
                    direction: 'outgoing',
                    body: message,
                    media: messageMedia ? messageMedia.data : null,
                    mimeType: messageMedia ? messageMedia.mimetype : null,
                    timestamp: new Date(),
                    ack: 1, // Sent to server
                    waId: sentMessage.id?.id
                });

                results.push({
                    chatId: chat.id._serialized,
                    status: 'success',
                    message: 'Message sent successfully'
                });

                // Add delay between messages to avoid rate limiting
                const randomDelay = Math.floor(Math.random() * 4000) + 1000; // 1-5 seconds
                await new Promise(resolve => setTimeout(resolve, randomDelay));
            } catch (error) {
                console.error(`Error sending message to ${chat.id._serialized}:`, error.message);
                results.push({
                    chatId: chat.id._serialized,
                    status: 'error',
                    message: error.message
                });
            }
        }

        // Clean up file if it exists
        if (file) {
            fs.unlink(file.path, err => {
                if (err) console.error('Error deleting file:', err.message);
            });
        }

        const successCount = results.filter(r => r.status === 'success').length;
        const errorCount = results.length - successCount;

        return res.status(200).json({
            success: true,
            message: `Messages sent to ${successCount} chats, ${errorCount} failed`,
            results
        });
    } catch (error) {
        console.error('Error in sendBulkToLabel:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to send messages: ' + error.message
        });
    }
}

module.exports = { sendBulkMessage, sendMessage, saveMessage, sendBulkToLabel };


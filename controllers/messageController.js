const { MessageMedia } = require("whatsapp-web.js");
const { parsePhoneNumber } = require("../utils/phoneUtils");
const fs = require("fs");
const {
  saveMessage: saveMessageService,
} = require("../services/whatapp-helper");
const { sendMessage: sendMessageService } = require('../services/messageSender');
const whatsappConfig = require('../config/whatsappConfig');
const { getRateLimitStats } = require('../utils/rateLimiter');

// numbers must be in this format
// 201061261991
async function sendBulkMessage(req, res) {
  const client = req.client;
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

  // Check batch size limit
  if (phoneNumbersArray.length > whatsappConfig.batchLimits.maxBatchSize) {
    return res.status(400).json({
      success: false,
      error: `Batch size exceeds maximum limit of ${whatsappConfig.batchLimits.maxBatchSize} messages`,
      requested: phoneNumbersArray.length,
      maxAllowed: whatsappConfig.batchLimits.maxBatchSize,
    });
  }

  if (!message && !file) {
    return res
      .status(400)
      .send("At least one of message or media is required.");
  }

  try {
    // Pre-create MessageMedia if file exists (to avoid reading file multiple times)
    let messageMedia = null;
    if (file) {
      messageMedia = MessageMedia.fromFilePath(file.path);
    }

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const phoneNumber of phoneNumbersArray) {
      try {
        const result = await sendMessageService(client, phoneNumber, message, messageMedia, true);
        
        if (result.success) {
          successCount++;
          results.push({
            phoneNumber: result.phoneNumber,
            status: result.warning ? 'warning' : 'success',
            message: result.warning || 'Message sent successfully',
            warning: result.warning || undefined
          });
        } else {
          errorCount++;
          results.push({
            phoneNumber: phoneNumber,
            status: 'error',
            message: result.error,
            rateLimitInfo: result.rateLimitInfo
          });

          // If rate limit exceeded, stop sending
          if (result.rateLimitInfo) {
            console.warn('Rate limit exceeded, stopping bulk send');
            break;
          }
        }
      } catch (err) {
        errorCount++;
        console.error(`Error processing ${phoneNumber}:`, err.message);
        results.push({
          phoneNumber: phoneNumber,
          status: 'error',
          message: err.message
        });
      }
    }

    // Clean up file if it exists
    if (file) {
      fs.unlink(file.path, (err) => {
        if (err) console.error("Error deleting file:", err.message);
      });
    }

    // Get rate limit stats
    const rateLimitStats = getRateLimitStats();

    return res.status(200).json({
      success: true,
      message: `Messages sent: ${successCount} successful, ${errorCount} failed`,
      results: results,
      rateLimitStats: rateLimitStats
    });
  } catch (error) {
    console.error("Error sending bulk messages:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to send messages: " + error.message
    });
  }
}

async function sendMessage(req, res) {
  const client = req.client;
  const { phoneNumber, message } = req.body;
  const file = req.file;

  if (!phoneNumber) {
    return res.status(400).json({ success: false, error: "Phone number is required." });
  }
  if (!message && !file) {
    return res
      .status(400)
      .json({ success: false, error: "At least one of message or media is required." });
  }

  try {
    const result = await sendMessageService(client, phoneNumber, message, file, false);

    if (!result.success) {
      // Handle rate limit errors with appropriate status code
      if (result.rateLimitInfo) {
        return res.status(429).json({
          success: false,
          error: result.error,
          rateLimitInfo: result.rateLimitInfo,
          rateLimitStats: getRateLimitStats()
        });
      }

      // Handle other errors
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }

    // Clean up file if it exists
    if (file) {
      fs.unlink(file.path, (err) => {
        if (err) console.error("Error deleting file:", err.message);
      });
    }

    // Save outgoing message to DB, including WhatsApp message id
    // await saveMessageService({
    //   contactNumber: result.phoneNumber,
    //   direction: "outgoing",
    //   body: message,
    //   media: file ? MessageMedia.fromFilePath(file.path).data : null,
    //   mimeType: file ? MessageMedia.fromFilePath(file.path).mimetype : null,
    //   timestamp: new Date(),
    //   ack: 1, // Sent to server
    //   waId: result.message?.id?.id || undefined,
    // });

    return res.status(200).json({
      success: true,
      message: "Message sent successfully",
      rateLimitStats: getRateLimitStats()
    });
  } catch (error) {
    console.error("Error sending message:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to send message: " + error.message
    });
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
        // Get client from request (set by middleware)
        const client = req.client;
        
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

        // Check batch size limit
        if (chatsWithLabel.length > whatsappConfig.batchLimits.maxBatchSize) {
            return res.status(400).json({
                success: false,
                error: `Number of chats (${chatsWithLabel.length}) exceeds maximum batch size limit of ${whatsappConfig.batchLimits.maxBatchSize}`,
                maxAllowed: whatsappConfig.batchLimits.maxBatchSize,
            });
        }

        // Pre-create MessageMedia if file exists (to avoid reading file multiple times)
        let messageMedia = null;
        if (file) {
            messageMedia = MessageMedia.fromFilePath(file.path);
        }

        const results = [];
        let successCount = 0;
        let errorCount = 0;

        for (const chat of chatsWithLabel) {
            try {
                // Extract phone number from chat ID
                const phoneNumber = chat.id.user || chat.id._serialized.split('@')[0];
                
                const result = await sendMessageService(client, phoneNumber, message, messageMedia, true);
                
                if (result.success) {
                    successCount++;
                    results.push({
                        chatId: chat.id._serialized,
                        phoneNumber: result.phoneNumber,
                        status: result.warning ? 'warning' : 'success',
                        message: result.warning || 'Message sent successfully',
                        warning: result.warning || undefined
                    });
                } else {
                    errorCount++;
                    results.push({
                        chatId: chat.id._serialized,
                        phoneNumber: phoneNumber,
                        status: 'error',
                        message: result.error,
                        rateLimitInfo: result.rateLimitInfo
                    });

                    // If rate limit exceeded, stop sending
                    if (result.rateLimitInfo) {
                        console.warn('Rate limit exceeded, stopping bulk send to label');
                        break;
                    }
                }
            } catch (error) {
                errorCount++;
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

        // Get rate limit stats
        const rateLimitStats = getRateLimitStats();

        return res.status(200).json({
            success: true,
            message: `Messages sent to ${successCount} chats, ${errorCount} failed`,
            results,
            rateLimitStats
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


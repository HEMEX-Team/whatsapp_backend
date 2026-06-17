/**
 * Message Sender Service
 * Centralized service for sending WhatsApp messages with spam prevention
 */

const { MessageMedia } = require('whatsapp-web.js');
const whatsappConfig = require('../config/whatsappConfig');
const { checkRateLimit, recordMessageSent } = require('../utils/rateLimiter');
const { parsePhoneNumber } = require('../utils/phoneUtils');
const crypto = require('crypto');

/**
 * Check if current time is within business hours
 */
function isBusinessHours() {
  const now = new Date();
  const hour = now.getHours();
  return hour >= whatsappConfig.timeRestrictions.businessHoursStart && 
         hour < whatsappConfig.timeRestrictions.businessHoursEnd;
}

/**
 * Check if current time is late night (12 AM - 6 AM)
 */
function isLateNight() {
  const now = new Date();
  const hour = now.getHours();
  return hour >= whatsappConfig.timeRestrictions.lateNightStart && 
         hour < whatsappConfig.timeRestrictions.lateNightEnd;
}

/**
 * Check if current time is early morning (6 AM - 9 AM)
 */
function isEarlyMorning() {
  const now = new Date();
  const hour = now.getHours();
  return hour >= whatsappConfig.timeRestrictions.earlyMorningStart && 
         hour < whatsappConfig.timeRestrictions.earlyMorningEnd;
}

/**
 * Get appropriate delay based on time of day and message type
 * @param {boolean} isBulk - Whether this is a bulk message
 * @returns {number} Delay in milliseconds
 */
function getDelayForTimeOfDay(isBulk = false) {
  if (isLateNight()) {
    // Late night: 5-10 minutes
    return Math.floor(Math.random() * 
      (whatsappConfig.delays.lateNightMax - whatsappConfig.delays.lateNightMin)) + 
      whatsappConfig.delays.lateNightMin;
  } else if (isEarlyMorning()) {
    // Early morning: 30-60 seconds
    return Math.floor(Math.random() * 
      (whatsappConfig.delays.earlyMorningMax - whatsappConfig.delays.earlyMorningMin)) + 
      whatsappConfig.delays.earlyMorningMin;
  } else if (isBulk) {
    // Business hours bulk: 15-45 seconds
    return Math.floor(Math.random() * 
      (whatsappConfig.delays.bulkMax - whatsappConfig.delays.bulkMin)) + 
      whatsappConfig.delays.bulkMin;
  } else {
    // Business hours single: 5-15 seconds
    return Math.floor(Math.random() * 
      (whatsappConfig.delays.singleMax - whatsappConfig.delays.singleMin)) + 
      whatsappConfig.delays.singleMin;
  }
}

/**
 * Check if error is a rate limit error
 * @param {Error} error - The error object
 * @returns {boolean} True if rate limit error
 */
function isRateLimitError(error) {
  if (!error || !error.message) return false;
  
  const errorMessage = error.message.toLowerCase();
  return whatsappConfig.rateLimitErrors.some(keyword => 
    errorMessage.includes(keyword.toLowerCase())
  );
}

/**
 * Calculate exponential backoff delay
 * @param {number} retryCount - Current retry attempt (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function getExponentialBackoffDelay(retryCount) {
  const delay = whatsappConfig.backoff.initialDelay * 
    Math.pow(whatsappConfig.backoff.multiplier, retryCount);
  return Math.min(delay, whatsappConfig.backoff.maxDelay);
}

/**
 * Send a single message with retry logic and error handling
 * @param {Object} client - WhatsApp client instance
 * @param {string} chatId - WhatsApp chat ID
 * @param {string|MessageMedia} content - Message content or media
 * @param {Object} options - Additional options (caption, etc.)
 * @param {string} phoneNumber - Phone number for rate limiting
 * @returns {Promise<Object>} { success: boolean, message?: Object, error?: string }
 */
async function sendMessageWithRetry(client, chatId, content, options = {}, phoneNumber = null) {
  // Check rate limits before sending
  const rateLimitCheck = checkRateLimit(phoneNumber);
  if (!rateLimitCheck.allowed) {
    return {
      success: false,
      error: rateLimitCheck.reason,
      rateLimitInfo: rateLimitCheck.limits,
    };
  }

  // Check time restrictions
  if (whatsappConfig.timeRestrictions.blockLateNight && isLateNight()) {
    return {
      success: false,
      error: 'Sending messages during late night hours (12 AM - 6 AM) is blocked to prevent spam detection',
    };
  }

  let lastError = null;
  
  // Retry with exponential backoff
  for (let retryCount = 0; retryCount <= whatsappConfig.backoff.maxRetries; retryCount++) {
    try {
      // Wait before retry (except first attempt)
      if (retryCount > 0) {
        const backoffDelay = getExponentialBackoffDelay(retryCount - 1);
        console.log(`Retrying after ${backoffDelay / 1000}s (attempt ${retryCount + 1}/${whatsappConfig.backoff.maxRetries + 1})...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }

      // Send message
      let sentMessage;
      if (content instanceof MessageMedia) {
        sentMessage = await client.sendMessage(chatId, content, options);
      } else {
        sentMessage = await client.sendMessage(chatId, content);
      }

      // Record successful send
      recordMessageSent(phoneNumber);

      return {
        success: true,
        message: sentMessage,
        chatId,
      };
    } catch (error) {
      lastError = error;
      console.error(`Error sending message (attempt ${retryCount + 1}):`, error.message);

      // If it's a rate limit error, use exponential backoff
      if (isRateLimitError(error)) {
        if (retryCount < whatsappConfig.backoff.maxRetries) {
          // Will retry with backoff
          continue;
        } else {
          // Max retries reached
          return {
            success: false,
            error: 'Rate limit error: Maximum retries exceeded. Please wait before sending more messages.',
            originalError: error.message,
          };
        }
      } else {
        // Non-rate-limit error, don't retry
        return {
          success: false,
          error: error.message || 'Failed to send message',
          originalError: error.message,
        };
      }
    }
  }

  // Should not reach here, but just in case
  return {
    success: false,
    error: lastError?.message || 'Failed to send message after retries',
  };
}

/**
 * Create a hash for message tracking (to prevent duplicates)
 * @param {string} phoneNumber - Phone number
 * @param {string} messageContent - Message content
 * @returns {string} Message hash
 */
function createMessageHash(phoneNumber, messageContent) {
  const hash = crypto.createHash('md5');
  hash.update(phoneNumber + (messageContent || ''));
  return hash.digest('hex');
}

function prepareMessageContent(message, fileOrMedia) {
  let messageMedia = null;
  if (fileOrMedia) {
    if (fileOrMedia instanceof MessageMedia) {
      messageMedia = fileOrMedia;
    } else if (fileOrMedia.path) {
      messageMedia = MessageMedia.fromFilePath(fileOrMedia.path);
    }
  }

  return {
    content: messageMedia || message,
    options: messageMedia && message ? { caption: message } : {},
  };
}

async function applyPostSendDelay(isBulk, success) {
  if (!success) return;

  const delay = getDelayForTimeOfDay(isBulk);
  await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Send a message to an existing chat by its WhatsApp ID (@c.us, @lid, @g.us, etc.)
 */
async function sendMessageToChat(client, chatId, message, fileOrMedia = null, isBulk = false, rateLimitKey = null) {
  try {
    const { content, options } = prepareMessageContent(message, fileOrMedia);
    const result = await sendMessageWithRetry(
      client,
      chatId,
      content,
      options,
      rateLimitKey ?? chatId
    );

    await applyPostSendDelay(isBulk, result.success);

    return {
      ...result,
      chatId,
    };
  } catch (error) {
    console.error('Error in sendMessageToChat:', error);
    return {
      success: false,
      error: error.message || 'Failed to send message',
      chatId,
    };
  }
}

/**
 * Resolve a phone number to the correct WhatsApp chat ID (@c.us or @lid).
 */
async function resolveChatId(client, phoneNumber) {
  let contactNumber;
  try {
    contactNumber = parsePhoneNumber(phoneNumber);
  } catch {
    return {
      success: false,
      error: 'Invalid phone number format',
    };
  }

  const digits = contactNumber.replace('+', '');
  const wid = await client.getNumberId(digits);

  if (!wid) {
    return {
      success: false,
      error: 'Number is not registered on WhatsApp',
      phoneNumber: contactNumber,
    };
  }

  return {
    success: true,
    chatId: wid._serialized,
    phoneNumber: contactNumber,
  };
}

/**
 * Send a message with all spam prevention measures
 * @param {Object} client - WhatsApp client instance
 * @param {string} phoneNumber - Phone number (will be parsed)
 * @param {string} message - Message text
 * @param {Object|MessageMedia} fileOrMedia - Optional file object from multer or pre-created MessageMedia
 * @param {boolean} isBulk - Whether this is part of a bulk send
 * @returns {Promise<Object>} Result object
 */
async function sendMessage(client, phoneNumber, message, fileOrMedia = null, isBulk = false) {
  try {
    const resolved = await resolveChatId(client, phoneNumber);
    if (!resolved.success) {
      return resolved;
    }

    const result = await sendMessageToChat(
      client,
      resolved.chatId,
      message,
      fileOrMedia,
      isBulk,
      resolved.phoneNumber
    );

    return {
      ...result,
      phoneNumber: resolved.phoneNumber,
    };
  } catch (error) {
    console.error('Error in sendMessage:', error);
    return {
      success: false,
      error: error.message || 'Failed to send message',
    };
  }
}

module.exports = {
  sendMessage,
  sendMessageToChat,
  resolveChatId,
  sendMessageWithRetry,
  isBusinessHours,
  isLateNight,
  isEarlyMorning,
  getDelayForTimeOfDay,
  createMessageHash,
  isRateLimitError,
};


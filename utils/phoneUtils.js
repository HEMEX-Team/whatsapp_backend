const { parsePhoneNumberFromString } = require('libphonenumber-js');

const WHATSAPP_ID_SUFFIXES = new Set(['c.us', 'g.us', 'lid', 's.whatsapp.net']);

function parsePhoneNumber(number) {
  if (number == null || String(number).trim() === '') {
    throw new Error('Phone number is required');
  }

  const raw = String(number).trim().split('@')[0];
  const normalized = raw.startsWith('+') ? raw : '+' + raw.replace(/\D/g, '');

  const parsed = parsePhoneNumberFromString(normalized);
  if (!parsed?.isValid()) {
    throw new Error(
      `Invalid phone number. Use full international format (e.g. 201140745452 or +201140745452): ${number}`
    );
  }

  return parsed.format('E.164');
}

function getChatId(number) {
  const e164 = parsePhoneNumber(number);
  const cleanNumber = e164.replace('+', '');
  const suffix = cleanNumber.length > 12 ? '@g.us' : '@c.us';
  return cleanNumber + suffix;
}

/**
 * Resolve a WhatsApp chat ID from a full serialized id or international phone number.
 */
function resolveWhatsAppChatId(input) {
  if (input == null || String(input).trim() === '') {
    throw new Error('Chat id or contact number is required');
  }

  const raw = String(input).trim();

  if (raw.includes('@')) {
    const [, suffix] = raw.split('@');
    if (!suffix || !WHATSAPP_ID_SUFFIXES.has(suffix)) {
      throw new Error(`Invalid WhatsApp chat id: ${input}`);
    }
    return raw;
  }

  return getChatId(raw);
}

function isLegacyBareGroupChatId(value) {
  return /^\d+$/.test(value) && /^120\d{12,}$/.test(value);
}

/** Newer WhatsApp group IDs, e.g. 201128758160-1618772560@g.us */
function isHyphenatedGroupChatId(value) {
  return /^\d+-\d+$/.test(value);
}

function isGroupChatUserPart(value) {
  return isLegacyBareGroupChatId(value) || isHyphenatedGroupChatId(value);
}

/**
 * Resolve send-message recipient: @g.us → phone → @lid → invalid.
 * Group IDs are checked before phone so long numeric group IDs are not
 * resolved to individual contacts via getNumberId.
 */
function resolveSendMessageRecipient(input) {
  if (input == null || String(input).trim() === '') {
    return { type: 'invalid' };
  }

  const raw = String(input).trim();

  if (raw.includes('@')) {
    const [userPart, suffix] = raw.split('@');

    if (suffix === 'lid') {
      return /^\d+$/.test(userPart)
        ? { type: 'lid', chatId: `${userPart}@lid` }
        : { type: 'invalid' };
    }
    if (suffix === 'g.us') {
      return isGroupChatUserPart(userPart)
        ? { type: 'group', chatId: `${userPart}@g.us` }
        : { type: 'invalid' };
    }
    if (suffix && !WHATSAPP_ID_SUFFIXES.has(suffix)) {
      return { type: 'invalid' };
    }
  }

  if (isGroupChatUserPart(raw)) {
    return { type: 'group', chatId: `${raw}@g.us` };
  }

  try {
    return { type: 'phone', value: parsePhoneNumber(raw) };
  } catch {
    // not a valid phone number
  }

  if (/^\d+$/.test(raw)) {
    return { type: 'lid', chatId: `${raw}@lid` };
  }

  return { type: 'invalid' };
}

/**
 * Destination chat JID for a sent message. Prefer group/chat remote id over
 * author/from fields, which may contain member phone numbers in group chats.
 */
function getSentMessageChatId(sentMessage, fallbackChatId) {
  if (!sentMessage) {
    return fallbackChatId;
  }

  const remote =
    typeof sentMessage.id?.remote === 'object'
      ? sentMessage.id.remote._serialized
      : sentMessage.id?.remote;

  if (typeof remote === 'string' && remote.includes('@')) {
    return remote;
  }

  if (
    sentMessage.fromMe &&
    typeof sentMessage.to === 'string' &&
    sentMessage.to.includes('@')
  ) {
    return sentMessage.to;
  }

  return fallbackChatId;
}

module.exports = {
  parsePhoneNumber,
  getChatId,
  resolveWhatsAppChatId,
  resolveSendMessageRecipient,
  getSentMessageChatId,
};

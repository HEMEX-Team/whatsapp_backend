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

module.exports = { parsePhoneNumber, getChatId, resolveWhatsAppChatId };

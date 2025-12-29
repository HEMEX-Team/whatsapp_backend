/**
 * Rate Limiter Utility
 * Tracks and enforces message sending rate limits
 */

const whatsappConfig = require('../config/whatsappConfig');

// In-memory store for rate limiting
// Structure: { key: { count: number, resetTime: timestamp } }
const rateLimitStore = new Map();

/**
 * Get current hour timestamp (for hourly limits)
 */
function getCurrentHour() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).getTime();
}

/**
 * Get current day timestamp (for daily limits)
 */
function getCurrentDay() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Clean up expired entries from the store
 */
function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Check if sending a message would exceed rate limits
 * @param {string} phoneNumber - Optional phone number for per-number limits
 * @returns {Object} { allowed: boolean, reason?: string, limits?: Object }
 */
function checkRateLimit(phoneNumber = null) {
  cleanupExpiredEntries();

  const now = Date.now();
  const currentHour = getCurrentHour();
  const currentDay = getCurrentDay();

  // Check daily limit (global)
  const dailyKey = `daily:${currentDay}`;
  const dailyCount = rateLimitStore.get(dailyKey)?.count || 0;
  if (dailyCount >= whatsappConfig.rateLimits.maxMessagesPerDay) {
    const resetTime = getCurrentDay() + 24 * 60 * 60 * 1000; // Next day
    return {
      allowed: false,
      reason: 'Daily message limit exceeded',
      limits: {
        current: dailyCount,
        max: whatsappConfig.rateLimits.maxMessagesPerDay,
        resetTime: new Date(resetTime),
      },
    };
  }

  // Check hourly limit (global)
  const hourlyKey = `hourly:${currentHour}`;
  const hourlyCount = rateLimitStore.get(hourlyKey)?.count || 0;
  if (hourlyCount >= whatsappConfig.rateLimits.maxMessagesPerHour) {
    const resetTime = currentHour + 60 * 60 * 1000; // Next hour
    return {
      allowed: false,
      reason: 'Hourly message limit exceeded',
      limits: {
        current: hourlyCount,
        max: whatsappConfig.rateLimits.maxMessagesPerHour,
        resetTime: new Date(resetTime),
      },
    };
  }

  // Check per-number daily limit (if phone number provided)
  if (phoneNumber) {
    const numberDailyKey = `number:${phoneNumber}:${currentDay}`;
    const numberDailyCount = rateLimitStore.get(numberDailyKey)?.count || 0;
    if (numberDailyCount >= whatsappConfig.rateLimits.maxMessagesPerNumberPerDay) {
      const resetTime = getCurrentDay() + 24 * 60 * 60 * 1000; // Next day
      return {
        allowed: false,
        reason: 'Daily message limit exceeded for this number',
        limits: {
          current: numberDailyCount,
          max: whatsappConfig.rateLimits.maxMessagesPerNumberPerDay,
          resetTime: new Date(resetTime),
        },
      };
    }
  }

  return { allowed: true };
}

/**
 * Record that a message was sent (increment counters)
 * @param {string} phoneNumber - Optional phone number for per-number tracking
 */
function recordMessageSent(phoneNumber = null) {
  const currentHour = getCurrentHour();
  const currentDay = getCurrentDay();

  // Increment daily counter
  const dailyKey = `daily:${currentDay}`;
  const dailyEntry = rateLimitStore.get(dailyKey) || { count: 0, resetTime: getCurrentDay() + 24 * 60 * 60 * 1000 };
  dailyEntry.count++;
  rateLimitStore.set(dailyKey, dailyEntry);

  // Increment hourly counter
  const hourlyKey = `hourly:${currentHour}`;
  const hourlyEntry = rateLimitStore.get(hourlyKey) || { count: 0, resetTime: currentHour + 60 * 60 * 1000 };
  hourlyEntry.count++;
  rateLimitStore.set(hourlyKey, hourlyEntry);

  // Increment per-number counter (if phone number provided)
  if (phoneNumber) {
    const numberDailyKey = `number:${phoneNumber}:${currentDay}`;
    const numberDailyEntry = rateLimitStore.get(numberDailyKey) || { count: 0, resetTime: getCurrentDay() + 24 * 60 * 60 * 1000 };
    numberDailyEntry.count++;
    rateLimitStore.set(numberDailyKey, numberDailyEntry);
  }
}

/**
 * Get current rate limit statistics
 * @returns {Object} Current rate limit stats
 */
function getRateLimitStats() {
  cleanupExpiredEntries();

  const currentHour = getCurrentHour();
  const currentDay = getCurrentDay();

  const dailyKey = `daily:${currentDay}`;
  const hourlyKey = `hourly:${currentHour}`;

  return {
    daily: {
      current: rateLimitStore.get(dailyKey)?.count || 0,
      max: whatsappConfig.rateLimits.maxMessagesPerDay,
      remaining: whatsappConfig.rateLimits.maxMessagesPerDay - (rateLimitStore.get(dailyKey)?.count || 0),
    },
    hourly: {
      current: rateLimitStore.get(hourlyKey)?.count || 0,
      max: whatsappConfig.rateLimits.maxMessagesPerHour,
      remaining: whatsappConfig.rateLimits.maxMessagesPerHour - (rateLimitStore.get(hourlyKey)?.count || 0),
    },
  };
}

/**
 * Reset rate limit counters (for testing/admin purposes)
 */
function resetRateLimits() {
  rateLimitStore.clear();
}

module.exports = {
  checkRateLimit,
  recordMessageSent,
  getRateLimitStats,
  resetRateLimits,
};


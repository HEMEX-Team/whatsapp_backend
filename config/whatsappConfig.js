/**
 * WhatsApp Configuration
 * Centralized configuration for WhatsApp message sending limits and restrictions
 */

module.exports = {
  // Rate limiting configuration
  rateLimits: {
    maxMessagesPerHour: 100,        // Maximum messages per hour
    maxMessagesPerDay: 1000,       // Maximum messages per day
    maxMessagesPerNumberPerDay: 5,  // Maximum messages to same number per day
  },

  // Delay configuration (in milliseconds)
  delays: {
    bulkMin: 15000,    // 15 seconds minimum delay for bulk messages
    bulkMax: 45000,    // 45 seconds maximum delay for bulk messages
    singleMin: 5000,   // 5 seconds minimum delay for single messages
    singleMax: 15000,  // 15 seconds maximum delay for single messages
    lateNightMin: 300000,  // 5 minutes minimum during late night (12 AM - 6 AM)
    lateNightMax: 600000,  // 10 minutes maximum during late night
    earlyMorningMin: 30000,  // 30 seconds minimum during early morning (6 AM - 9 AM)
    earlyMorningMax: 60000,  // 60 seconds maximum during early morning
  },

  // Time-based restrictions
  timeRestrictions: {
    businessHoursStart: 9,   // 9 AM - Start of business hours
    businessHoursEnd: 20,    // 8 PM - End of business hours
    lateNightStart: 0,        // 12 AM - Start of late night
    lateNightEnd: 6,          // 6 AM - End of late night
    earlyMorningStart: 6,     // 6 AM - Start of early morning
    earlyMorningEnd: 9,       // 9 AM - End of early morning
    blockLateNight: false,     // Block sending during late night hours
  },

  // Batch size limits
  batchLimits: {
    maxBatchSize: 1000,         // Maximum messages per bulk request
  },

  // Exponential backoff configuration
  backoff: {
    initialDelay: 30000,      // 30 seconds initial delay
    maxDelay: 3600000,        // 1 hour maximum delay
    maxRetries: 2,            // Maximum retry attempts
    multiplier: 2,            // Exponential multiplier
  },

  // Rate limit error detection
  rateLimitErrors: [
    'rate limit',
    'too many requests',
    '429',
    'temporarily blocked',
    'blocked',
    'spam',
  ],
};


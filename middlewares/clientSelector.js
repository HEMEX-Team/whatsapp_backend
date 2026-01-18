const { getClient, isClientReady } = require('../services/clientManager');

/**
 * Middleware to extract client ID from X-Client-Id header and attach client to request
 * The client ID should be a phone number
 */
async function clientSelector(req, res, next) {
  try {
    // Extract client ID from header
    const clientId = req.headers['x-client-id'] || req.headers['X-Client-Id'];
    
    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: 'X-Client-Id header is required. Please provide the phone number of the WhatsApp client.'
      });
    }

    // Normalize phone number (remove + and spaces)
    const phoneNumber = clientId.trim().replace(/[+\s]/g, '');
    
    // Basic validation: phone number should be numeric (allowing + at start)
    if (!/^\d+$/.test(phoneNumber) || phoneNumber.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. X-Client-Id must be a valid phone number (digits only, minimum 10 digits).'
      });
    }

    // Get or create the client
    let clientData;
    try {
      clientData = await getClient(phoneNumber);
    } catch (error) {
      console.error(`[ClientSelector] Error getting client ${phoneNumber}:`, error);
      return res.status(500).json({
        success: false,
        error: `Failed to initialize client: ${error.message}`
      });
    }

    if (!clientData || !clientData.client) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get client instance'
      });
    }

    // Check if client is ready
    if (!isClientReady(phoneNumber)) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp client is not ready yet. Please wait for the client to initialize and scan the QR code.',
        clientId: phoneNumber,
        status: 'initializing'
      });
    }

    // Attach client and phone number to request object
    req.client = clientData.client;
    req.clientPhoneNumber = phoneNumber;

    next();
  } catch (error) {
    console.error('[ClientSelector] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error while selecting client',
      message: error.message
    });
  }
}

module.exports = clientSelector;

const { getClient, isClientReady, findClientDoc } = require('../services/clientManager');
const { debugLog } = require('../utils/debugLog');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function clientSelector(req, res, next) {
  try {
    const clientId = req.headers['x-client-id'] || req.headers['X-Client-Id'];

    if (!clientId) {
      return res.status(400).json({
        success: false,
        error: 'X-Client-Id header is required. Please provide the device ID or phone number of the WhatsApp client.'
      });
    }

    const trimmed = String(clientId).trim();
    const isDeviceId = UUID_REGEX.test(trimmed);
    const normalizedPhone = trimmed.replace(/[+\s]/g, '');
    const isPhone = /^\d+$/.test(normalizedPhone) && normalizedPhone.length >= 10;

    if (!isDeviceId && !isPhone) {
      return res.status(400).json({
        success: false,
        error: 'Invalid X-Client-Id format. Must be a device UUID or a valid phone number (digits only, minimum 10 digits).'
      });
    }

    const clientDoc = await findClientDoc(trimmed);
    if (!clientDoc) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    let clientData;
    try {
      clientData = await getClient(clientDoc.deviceId);
    } catch (error) {
      console.error(`[ClientSelector] Error getting client ${clientDoc.deviceId}:`, error);
      return res.status(500).json({
        success: false,
        error: `Failed to initialize client: ${error.message}`
      });
    }

    if (!clientData?.client) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get client instance'
      });
    }

    const ready = await isClientReady(clientDoc.deviceId);
    // #region agent log
    debugLog('clientSelector.js:readyCheck', 'selector readiness evaluated', {
      clientId: trimmed,
      resolvedDeviceId: clientDoc.deviceId,
      ready,
      hasPhone: !!(clientData.phoneNumber || clientDoc.phoneNumber)
    }, 'H6');
    // #endregion

    if (!ready) {
      // #region agent log
      debugLog('clientSelector.js:notReady', 'selector blocked request', {
        clientId: trimmed,
        resolvedDeviceId: clientDoc.deviceId,
        path: req.path,
        method: req.method
      }, 'H6');
      // #endregion
      return res.status(503).json({
        success: false,
        error: 'WhatsApp client is not ready yet. Please wait for the client to initialize and scan the QR code.',
        clientId: clientDoc.deviceId,
        status: 'initializing'
      });
    }

    req.client = clientData.client;
    req.clientDeviceId = clientDoc.deviceId;
    req.clientPhoneNumber = clientData.phoneNumber || clientDoc.phoneNumber;
    // #region agent log
    debugLog('clientSelector.js:passed', 'selector passed request', {
      resolvedDeviceId: req.clientDeviceId,
      path: req.path,
      method: req.method
    }, 'H6');
    // #endregion

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

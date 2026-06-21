const {
  getRuntime,
  getDefaultReadyRuntime,
  isRuntimeReady,
} = require('../services/clientManager');

// X-Client-Id is optional by default. Set ENFORCE_X_CLIENT_ID=true to require it later.
function clientSelector(req, res, next) {
  const clientId = req.headers['x-client-id'];
  const enforceHeader = process.env.ENFORCE_X_CLIENT_ID === 'true';

  if (!clientId && enforceHeader) {
    return res.status(400).json({
      success: false,
      message: 'X-Client-Id header is required',
    });
  }

  let runtime = clientId ? getRuntime(clientId) : null;

  if (clientId && !runtime) {
    return res.status(404).json({
      success: false,
      message: 'Client not found',
    });
  }

  if (!runtime) {
    runtime = getDefaultReadyRuntime();
  }

  if (!runtime) {
    return res.status(503).json({
      success: false,
      message:
        'No WhatsApp client is ready. Pair a device first or wait for initialization.',
      isReady: false,
    });
  }

  if (!isRuntimeReady(runtime)) {
    return res.status(503).json({
      success: false,
      message: 'WhatsApp client is not ready yet. Please wait for the client to initialize.',
      isReady: false,
    });
  }

  req.whatsappClient = runtime.client;
  req.clientDeviceId = runtime.deviceId;
  req.clientPhoneNumber = runtime.phoneNumber;
  req.isClientReady = true;

  next();
}

module.exports = clientSelector;

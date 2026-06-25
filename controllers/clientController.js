const {
  listAllClients,
  provisionClient,
  registerClient,
  toClientDto,
  updateClientName,
  getClientQr,
  removeClient,
  waitForQr,
} = require('../services/clientManager');

async function listClients(req, res) {
  try {
    const clients = await listAllClients();
    return res.json({ success: true, clients, count: clients.length });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to list clients',
      error: error.message,
    });
  }
}

async function createClient(req, res) {
  try {
    const { phoneNumber, name } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'phoneNumber is required',
      });
    }

    const dbRecord = await registerClient(phoneNumber, name);
    const client = await toClientDto(dbRecord.deviceId);

    return res.status(201).json({
      success: true,
      message: 'Client registered',
      client,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to register client',
    });
  }
}

async function provision(req, res) {
  try {
    const { deviceId, runtime } = await provisionClient();
    const gotQr = await waitForQr(runtime, 120000);
    // #region agent log
    const { debugLog } = require('../utils/debugLog');
    debugLog('clientController.js:provision', 'provision complete', { deviceId, gotQr, hasImage: !!runtime.qrCodeImage }, 'H-BE-QR');
    // #endregion
    const client = await toClientDto(deviceId);

    return res.status(201).json({
      success: true,
      message: gotQr ? 'Device provisioning started' : 'Device provisioning started; QR not ready yet',
      deviceId,
      client,
      qrCode: runtime.qrCode,
      qrCodeImage: runtime.qrCodeImage,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to provision client',
      error: error.message,
    });
  }
}

async function getClientStatus(req, res) {
  try {
    const { deviceId } = req.params;
    const client = await toClientDto(deviceId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    return res.json({ success: true, client });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get client status',
      error: error.message,
    });
  }
}

async function getQr(req, res) {
  try {
    const { deviceId } = req.params;
    const client = await toClientDto(deviceId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    const { qrCode, qrCodeImage } = await getClientQr(deviceId);
    return res.json({
      success: true,
      deviceId,
      qrCode,
      qrCodeImage,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to get QR code',
    });
  }
}

async function updateClient(req, res) {
  try {
    const { deviceId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'name is required',
      });
    }

    await updateClientName(deviceId, name.trim());
    const client = await toClientDto(deviceId);

    return res.json({
      success: true,
      message: 'Client updated',
      client,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      message: error.message || 'Failed to update client',
    });
  }
}

async function deleteClient(req, res) {
  try {
    const { deviceId } = req.params;
    const client = await toClientDto(deviceId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found',
      });
    }

    await removeClient(deviceId, true);
    return res.json({
      success: true,
      message: 'Client removed',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to remove client',
      error: error.message,
    });
  }
}

module.exports = {
  listClients,
  createClient,
  provision,
  getClientStatus,
  getQr,
  updateClient,
  deleteClient,
};

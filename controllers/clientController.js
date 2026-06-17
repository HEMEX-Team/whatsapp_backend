const {
  getClient,
  getAllClients,
  initializeClient,
  provisionClient,
  removeClient,
  getClientStatus,
  updateClientName,
  isClientReady,
  findClientDoc
} = require('../services/clientManager');
const ClientModel = require('../models/Client');
const QRCode = require('qrcode');

async function convertQRCodeToImage(qrCodeString) {
  if (!qrCodeString) {
    return null;
  }

  try {
    return await QRCode.toDataURL(qrCodeString, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M'
    });
  } catch (error) {
    console.error('[convertQRCodeToImage] Error converting QR code:', error);
    return null;
  }
}

async function resolveClientParam(req, res) {
  const { deviceId } = req.params;
  if (!deviceId) {
    res.status(400).json({ success: false, error: 'deviceId is required' });
    return null;
  }

  const clientDoc = await findClientDoc(deviceId);
  if (!clientDoc) {
    res.status(404).json({ success: false, error: 'Client not found' });
    return null;
  }

  return clientDoc;
}

async function registerClient(req, res) {
  try {
    const { phoneNumber, name } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'phoneNumber is required'
      });
    }

    const normalizedPhone = phoneNumber.replace(/[+\s]/g, '');

    if (!/^\d+$/.test(normalizedPhone) || normalizedPhone.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Must be numeric with at least 10 digits.'
      });
    }

    const existingClient = await ClientModel.findOne({ phoneNumber: normalizedPhone });
    if (existingClient) {
      const status = await getClientStatus(existingClient.deviceId);
      const qrCodeImage = await convertQRCodeToImage(existingClient.qrCode);

      return res.status(200).json({
        success: true,
        message: 'Client already exists',
        client: status,
        qrCode: existingClient.qrCode || null,
        qrCodeImage
      });
    }

    const clientData = await initializeClient(normalizedPhone, name);
    const status = await getClientStatus(clientData.deviceId);
    const qrCodeImage = await convertQRCodeToImage(clientData.qrCode);

    return res.status(201).json({
      success: true,
      message: 'Client registered successfully',
      client: status,
      qrCode: clientData.qrCode || null,
      qrCodeImage
    });
  } catch (error) {
    console.error('[registerClient] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to register client',
      message: error.message
    });
  }
}

async function provisionClientHandler(req, res) {
  try {
    const clientData = await provisionClient();
    const { deviceId } = clientData;

    let qrCode = clientData.qrCode;
    const maxWaitTime = 15000;
    const pollInterval = 500;
    let waited = 0;

    while (!qrCode && waited < maxWaitTime) {
      const clientDoc = await ClientModel.findOne({ deviceId });
      if (clientDoc?.qrCode) {
        qrCode = clientDoc.qrCode;
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      waited += pollInterval;
    }

    const status = await getClientStatus(deviceId);
    const qrCodeImage = await convertQRCodeToImage(qrCode);

    return res.status(201).json({
      success: true,
      message: 'Device provisioned. Scan the QR code to authenticate.',
      deviceId,
      client: status,
      qrCode: qrCode || null,
      qrCodeImage
    });
  } catch (error) {
    console.error('[provisionClient] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to provision client',
      message: error.message
    });
  }
}

async function listClients(req, res) {
  try {
    const clients = await getAllClients();

    return res.status(200).json({
      success: true,
      clients,
      count: clients.length
    });
  } catch (error) {
    console.error('[listClients] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to list clients',
      message: error.message
    });
  }
}

async function getClientStatusInfo(req, res) {
  try {
    const clientDoc = await resolveClientParam(req, res);
    if (!clientDoc) return;

    const status = await getClientStatus(clientDoc.deviceId);

    return res.status(200).json({
      success: true,
      client: status
    });
  } catch (error) {
    console.error('[getClientStatusInfo] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get client status',
      message: error.message
    });
  }
}

async function updateClient(req, res) {
  try {
    const clientDoc = await resolveClientParam(req, res);
    if (!clientDoc) return;

    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        error: 'name is required'
      });
    }

    const status = await updateClientName(clientDoc.deviceId, name);

    return res.status(200).json({
      success: true,
      message: 'Client updated successfully',
      client: status
    });
  } catch (error) {
    console.error('[updateClient] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update client',
      message: error.message
    });
  }
}

async function getClientQR(req, res) {
  try {
    const clientDoc = await resolveClientParam(req, res);
    if (!clientDoc) return;

    const { deviceId } = clientDoc;

    const clientIsReady = await isClientReady(deviceId);
    const clientStatus = await getClientStatus(deviceId);

    if (clientIsReady || (clientStatus && clientStatus.status === 'active' && clientStatus.phoneNumber)) {
      return res.status(200).json({
        success: true,
        message: 'Client is already authenticated and ready. No QR code needed.',
        status: 'active',
        isAuthenticated: true,
        deviceId,
        phoneNumber: clientStatus.phoneNumber
      });
    }

    let qrCode = clientDoc.qrCode;
    let qrCodeImage = null;

    const needsFreshQR = !clientIsReady && (
      clientDoc.status === 'inactive' ||
      clientDoc.status === 'initializing' ||
      (clientStatus && (clientStatus.status === 'inactive' || clientStatus.status === 'initializing'))
    );

    if (needsFreshQR && !qrCode) {
      try {
        await ClientModel.findOneAndUpdate(
          { deviceId },
          { qrCode: null, status: 'initializing', updatedAt: new Date() }
        );
        await removeClient(deviceId);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (removeError) {
        console.warn(`[getClientQR] Error refreshing client:`, removeError.message);
      }
    }

    if (!qrCode) {
      const clientData = await getClient(deviceId);

      const maxWaitTime = 15000;
      const pollInterval = 500;
      let waited = 0;

      while (waited < maxWaitTime) {
        const refreshedDoc = await ClientModel.findOne({ deviceId });
        if (refreshedDoc?.qrCode) {
          qrCode = refreshedDoc.qrCode;
          break;
        }

        if (clientData.qrCode) {
          qrCode = clientData.qrCode;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        waited += pollInterval;
      }
    }

    if (qrCode) {
      qrCodeImage = await convertQRCodeToImage(qrCode);

      return res.status(200).json({
        success: true,
        qrCode,
        qrCodeImage,
        deviceId,
        phoneNumber: clientStatus?.phoneNumber || null,
        status: 'initializing',
        isAuthenticated: false,
        message: 'Scan this QR code with WhatsApp on your phone to authenticate.'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'QR code is being generated. Please wait a moment and try again.',
      deviceId,
      status: 'initializing',
      isAuthenticated: false,
      qrCode: null,
      qrCodeImage: null
    });
  } catch (error) {
    console.error('[getClientQR] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to get QR code',
      message: error.message
    });
  }
}

async function getClientQRImage(req, res) {
  try {
    const clientDoc = await resolveClientParam(req, res);
    if (!clientDoc) return;

    if (!clientDoc.qrCode) {
      return res.status(404).json({
        success: false,
        error: 'QR code not available. Client may already be authenticated.'
      });
    }

    const qrBuffer = await QRCode.toBuffer(clientDoc.qrCode, {
      type: 'png',
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M'
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="qr-${clientDoc.deviceId}.png"`);
    res.send(qrBuffer);
  } catch (error) {
    console.error('[getClientQRImage] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate QR code image',
      message: error.message
    });
  }
}

async function deleteClient(req, res) {
  try {
    const clientDoc = await resolveClientParam(req, res);
    if (!clientDoc) return;

    await removeClient(clientDoc.deviceId);

    return res.status(200).json({
      success: true,
      message: 'Client removed successfully',
      deviceId: clientDoc.deviceId
    });
  } catch (error) {
    console.error('[deleteClient] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to remove client',
      message: error.message
    });
  }
}

module.exports = {
  registerClient,
  provisionClientHandler,
  listClients,
  getClientStatusInfo,
  updateClient,
  getClientQR,
  getClientQRImage,
  deleteClient
};

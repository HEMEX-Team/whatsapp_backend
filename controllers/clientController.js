const {
  getClient,
  getAllClients,
  initializeClient,
  removeClient,
  getClientStatus,
  isClientReady
} = require('../services/clientManager');
const ClientModel = require('../models/Client');
const QRCode = require('qrcode');

/**
 * Helper function to convert QR code string to image data URL
 * @param {string} qrCodeString - QR code string from WhatsApp
 * @returns {Promise<string|null>} Data URL of the QR code image or null
 */
async function convertQRCodeToImage(qrCodeString) {
  if (!qrCodeString) {
    return null;
  }
  
  try {
    const dataUrl = await QRCode.toDataURL(qrCodeString, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M'
    });
    return dataUrl;
  } catch (error) {
    console.error('[convertQRCodeToImage] Error converting QR code:', error);
    return null;
  }
}

/**
 * Register a new WhatsApp client
 * POST /clients
 * Body: { phoneNumber: string, name?: string }
 */
async function registerClient(req, res) {
  try {
    const { phoneNumber, name } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'phoneNumber is required'
      });
    }

    // Normalize phone number
    const normalizedPhone = phoneNumber.replace(/[+\s]/g, '');

    // Validate phone number format
    if (!/^\d+$/.test(normalizedPhone) || normalizedPhone.length < 10) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number format. Must be numeric with at least 10 digits.'
      });
    }

    // Check if client already exists
    const existingClient = await ClientModel.findOne({ phoneNumber: normalizedPhone });
    if (existingClient) {
      // Return existing client status
      const status = await getClientStatus(normalizedPhone);
      
      // Convert QR code to image if available
      const qrCodeImage = await convertQRCodeToImage(existingClient.qrCode);
      
      return res.status(200).json({
        success: true,
        message: 'Client already exists',
        client: status,
        qrCode: existingClient.qrCode || null,
        qrCodeImage: qrCodeImage
      });
    }

    // Initialize the client
    const clientData = await initializeClient(normalizedPhone);

    // Update name if provided
    if (name) {
      await ClientModel.findOneAndUpdate(
        { phoneNumber: normalizedPhone },
        { name: name.trim() }
      );
    }

    // Get client status
    const status = await getClientStatus(normalizedPhone);

    // Convert QR code to image if available
    const qrCodeImage = await convertQRCodeToImage(clientData.qrCode);

    return res.status(201).json({
      success: true,
      message: 'Client registered successfully',
      client: status,
      qrCode: clientData.qrCode || null,
      qrCodeImage: qrCodeImage
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

/**
 * List all registered clients
 * GET /clients
 */
async function listClients(req, res) {
  try {
    console.log('[listClients] Fetching all clients...');
    const clients = await getAllClients();
    console.log(`[listClients] Returning ${clients.length} clients`);

    return res.status(200).json({
      success: true,
      clients: clients,
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

/**
 * Get specific client status
 * GET /clients/:phoneNumber
 */
async function getClientStatusInfo(req, res) {
  try {
    const { phoneNumber } = req.params;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'phoneNumber is required'
      });
    }

    const normalizedPhone = phoneNumber.replace(/[+\s]/g, '');
    const status = await getClientStatus(normalizedPhone);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

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

/**
 * Get QR code for client initialization
 * GET /clients/:phoneNumber/qr
 */
async function getClientQR(req, res) {
  try {
    const { phoneNumber } = req.params;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'phoneNumber is required'
      });
    }

    const normalizedPhone = phoneNumber.replace(/[+\s]/g, '');
    const clientDoc = await ClientModel.findOne({ phoneNumber: normalizedPhone });

    if (!clientDoc) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    // If no QR code, try to initialize client
    if (!clientDoc.qrCode) {
      try {
        await initializeClient(normalizedPhone);
        // Wait a bit for QR code generation
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Re-fetch from database
        const updatedDoc = await ClientModel.findOne({ phoneNumber: normalizedPhone });
        if (updatedDoc && updatedDoc.qrCode) {
          // Convert QR code to image
          const qrCodeImage = await convertQRCodeToImage(updatedDoc.qrCode);
          
          return res.status(200).json({
            success: true,
            qrCode: updatedDoc.qrCode,
            qrCodeImage: qrCodeImage,
            phoneNumber: normalizedPhone,
            status: 'initializing'
          });
        }
      } catch (error) {
        console.error('[getClientQR] Error initializing client:', error);
      }
    }

    if (!clientDoc.qrCode) {
      return res.status(404).json({
        success: false,
        error: 'QR code not available. Client may already be authenticated.'
      });
    }

    // Convert QR code to image
    const qrCodeImage = await convertQRCodeToImage(clientDoc.qrCode);

    return res.status(200).json({
      success: true,
      qrCode: clientDoc.qrCode,
      qrCodeImage: qrCodeImage,
      phoneNumber: normalizedPhone,
      status: clientDoc.status
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

/**
 * Get QR code as PNG image
 * GET /clients/:phoneNumber/qr/image
 */
async function getClientQRImage(req, res) {
  try {
    const { phoneNumber } = req.params;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'phoneNumber is required'
      });
    }

    const normalizedPhone = phoneNumber.replace(/[+\s]/g, '');
    const clientDoc = await ClientModel.findOne({ phoneNumber: normalizedPhone });

    if (!clientDoc) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    if (!clientDoc.qrCode) {
      return res.status(404).json({
        success: false,
        error: 'QR code not available. Client may already be authenticated.'
      });
    }

    // Generate QR code as PNG buffer
    const qrBuffer = await QRCode.toBuffer(clientDoc.qrCode, {
      type: 'png',
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M'
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="qr-${normalizedPhone}.png"`);
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

/**
 * Delete/Remove a client
 * DELETE /clients/:phoneNumber
 */
async function deleteClient(req, res) {
  try {
    const { phoneNumber } = req.params;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'phoneNumber is required'
      });
    }

    const normalizedPhone = phoneNumber.replace(/[+\s]/g, '');
    const clientDoc = await ClientModel.findOne({ phoneNumber: normalizedPhone });

    if (!clientDoc) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    await removeClient(normalizedPhone);

    return res.status(200).json({
      success: true,
      message: 'Client removed successfully',
      phoneNumber: normalizedPhone
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
  listClients,
  getClientStatusInfo,
  getClientQR,
  getClientQRImage,
  deleteClient
};

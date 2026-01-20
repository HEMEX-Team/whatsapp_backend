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
    
    // Check if client exists in database
    let clientDoc = await ClientModel.findOne({ phoneNumber: normalizedPhone });

    if (!clientDoc) {
      return res.status(404).json({
        success: false,
        error: 'Client not found'
      });
    }

    // Check if client is already authenticated and ready
    const clientIsReady = isClientReady(normalizedPhone);
    const clientStatus = await getClientStatus(normalizedPhone);
    
    if (clientIsReady || (clientStatus && clientStatus.status === 'active')) {
      // Client is already authenticated, no QR code needed
      return res.status(200).json({
        success: true,
        message: 'Client is already authenticated and ready. No QR code needed.',
        status: 'active',
        isAuthenticated: true,
        phoneNumber: normalizedPhone
      });
    }

    // Client is not authenticated, we need a QR code
    // For inactive clients, we need to clear old QR code and force fresh generation
    let qrCode = null;
    let qrCodeImage = null;

    try {
      // Check if client is inactive or initializing but not ready - if so, we need to force fresh QR code generation
      // This ensures we don't return expired QR codes
      const needsFreshQR = !clientIsReady && (
        clientDoc.status === 'inactive' || 
        clientDoc.status === 'initializing' ||
        (clientStatus && (clientStatus.status === 'inactive' || clientStatus.status === 'initializing'))
      );
      
      if (needsFreshQR) {
        console.log(`[getClientQR] Client ${normalizedPhone} is inactive, clearing old QR code and forcing re-initialization`);
        
        // Clear old QR code from database
        try {
          await ClientModel.findOneAndUpdate(
            { phoneNumber: normalizedPhone },
            { 
              qrCode: null,
              status: 'initializing',
              updatedAt: new Date()
            }
          );
        } catch (dbError) {
          console.warn(`[getClientQR] Error clearing old QR code:`, dbError.message);
        }
        
        // Remove existing inactive client instance to force fresh initialization
        try {
          await removeClient(normalizedPhone);
          console.log(`[getClientQR] Removed inactive client instance for ${normalizedPhone}`);
        } catch (removeError) {
          console.warn(`[getClientQR] Error removing inactive client (may not exist):`, removeError.message);
        }
        
        // Wait a moment for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Initialize client (will create new instance if removed, or use existing if active)
      console.log(`[getClientQR] Initializing client ${normalizedPhone} to generate QR code`);
      await initializeClient(normalizedPhone);
      
      // Wait for QR code to be generated (with timeout)
      const maxWaitTime = 15000; // 15 seconds for fresh QR code generation
      const pollInterval = 500; // 500ms
      let waited = 0;
      
      while (waited < maxWaitTime) {
        // Check database for new QR code
        clientDoc = await ClientModel.findOne({ phoneNumber: normalizedPhone });
        if (clientDoc && clientDoc.qrCode) {
          qrCode = clientDoc.qrCode;
          console.log(`[getClientQR] Found fresh QR code for ${normalizedPhone}`);
          break;
        }
        
        // Check in-memory client data
        try {
          const clientData = await getClient(normalizedPhone);
          if (clientData && clientData.qrCode) {
            qrCode = clientData.qrCode;
            console.log(`[getClientQR] Found fresh QR code in memory for ${normalizedPhone}`);
            break;
          }
        } catch (err) {
          // Continue polling if getClient fails
          console.warn(`[getClientQR] Error checking client:`, err.message);
        }
        
        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        waited += pollInterval;
      }
      
      if (!qrCode) {
        console.warn(`[getClientQR] No QR code generated after ${maxWaitTime}ms for ${normalizedPhone}`);
      }
      
      if (qrCode) {
          // Convert QR code to image
        qrCodeImage = await convertQRCodeToImage(qrCode);
          
          return res.status(200).json({
            success: true,
          qrCode: qrCode,
            qrCodeImage: qrCodeImage,
            phoneNumber: normalizedPhone,
          status: 'initializing',
          isAuthenticated: false,
          message: 'Scan this QR code with WhatsApp on your phone to authenticate.'
        });
      } else {
        // QR code generation might be in progress, but we don't have it yet
        return res.status(200).json({
          success: true,
          message: 'QR code is being generated. Please wait a moment and try again.',
          phoneNumber: normalizedPhone,
          status: 'initializing',
          isAuthenticated: false,
          qrCode: null,
          qrCodeImage: null
          });
        }
      } catch (error) {
        console.error('[getClientQR] Error initializing client:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to initialize client and generate QR code',
        message: error.message
      });
    }
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

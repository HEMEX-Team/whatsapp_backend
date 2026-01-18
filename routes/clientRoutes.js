const express = require('express');
const router = express.Router();
const {
  registerClient,
  listClients,
  getClientStatusInfo,
  getClientQR,
  getClientQRImage,
  deleteClient
} = require('../controllers/clientController');

// Register a new client
router.post('/', registerClient);

// List all clients
router.get('/', listClients);

// Get QR code as PNG image (must be before /:phoneNumber/qr route)
router.get('/:phoneNumber/qr/image', getClientQRImage);

// Get QR code for client (JSON with qrCodeImage data URL)
router.get('/:phoneNumber/qr', getClientQR);

// Get specific client status
router.get('/:phoneNumber', getClientStatusInfo);

// Delete a client
router.delete('/:phoneNumber', deleteClient);

module.exports = router;

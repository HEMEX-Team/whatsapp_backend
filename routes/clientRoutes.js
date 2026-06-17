const express = require('express');
const router = express.Router();
const {
  registerClient,
  provisionClientHandler,
  listClients,
  getClientStatusInfo,
  updateClient,
  getClientQR,
  getClientQRImage,
  deleteClient
} = require('../controllers/clientController');

router.post('/provision', provisionClientHandler);
router.post('/', registerClient);
router.get('/', listClients);
router.get('/:deviceId/qr/image', getClientQRImage);
router.get('/:deviceId/qr', getClientQR);
router.patch('/:deviceId', updateClient);
router.get('/:deviceId', getClientStatusInfo);
router.delete('/:deviceId', deleteClient);

module.exports = router;

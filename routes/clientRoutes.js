const express = require('express');
const router = express.Router();
const {
  listClients,
  createClient,
  provision,
  getClientStatus,
  getQr,
  updateClient,
  deleteClient,
} = require('../controllers/clientController');

router.get('/', listClients);
router.post('/', createClient);
router.post('/provision', provision);
router.get('/:deviceId/qr', getQr);
router.get('/:deviceId', getClientStatus);
router.patch('/:deviceId', updateClient);
router.delete('/:deviceId', deleteClient);

module.exports = router;

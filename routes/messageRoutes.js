const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');
const { saveMessage, sendMessage, sendBulkMessage, sendBulkToLabel } = require('../controllers/messageController');

router.post('/save-message', saveMessage);

router.post('/send-message', upload.single('file'), (req, res) =>
  sendMessage(req, res, req.whatsappClient)
);

router.post('/send-bulk-message', upload.single('file'), (req, res) =>
  sendBulkMessage(req, res, req.whatsappClient)
);

router.post('/send-bulk-to-label', upload.single('file'), (req, res) =>
  sendBulkToLabel(req, res, req.whatsappClient)
);

module.exports = router;

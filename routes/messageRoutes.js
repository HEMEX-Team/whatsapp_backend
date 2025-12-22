const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');
const { saveMessage, sendMessage, sendBulkMessage, sendBulkToLabel } = require('../controllers/messageController');
const { client } = require('../services/whatsApp');

router.post('/save-message', saveMessage);

router.post('/send-message', upload.single('file'), (req, res) => sendMessage(req, res, client));

router.post('/send-bulk-message', upload.single('file'), (req, res) => sendBulkMessage(req, res, client));

// Send message to all chats with a specific label
router.post('/send-bulk-to-label', upload.single('file'), (req, res) => sendBulkToLabel(req, res));

module.exports = router;

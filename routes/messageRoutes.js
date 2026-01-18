const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');
const clientSelector = require('../middlewares/clientSelector');
const { saveMessage, sendMessage, sendBulkMessage, sendBulkToLabel } = require('../controllers/messageController');

router.post('/save-message', saveMessage);

router.post('/send-message', upload.single('file'), clientSelector, sendMessage);

router.post('/send-bulk-message', upload.single('file'), clientSelector, sendBulkMessage);

// Send message to all chats with a specific label
router.post('/send-bulk-to-label', upload.single('file'), clientSelector, sendBulkToLabel);

module.exports = router;

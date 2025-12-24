const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');
const {sendMessage} = require('../controllers/messageController');
const { client } = require('../services/whatsApp');
const { getChatsReportExposed } = require('../controllers/chatController');

router.post('/send-message', upload.single('file'), (req, res) => sendMessage(req, res, client));
router.get('/report', getChatsReportExposed);

module.exports = router;

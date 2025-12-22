const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');
const {sendMessage} = require('../controllers/messageController');
const { client } = require('../services/whatsApp');

router.post('/send-message', upload.single('file'), (req, res) => sendMessage(req, res, client));

module.exports = router;

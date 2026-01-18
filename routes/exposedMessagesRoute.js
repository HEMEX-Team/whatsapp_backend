const express = require('express');
const router = express.Router();
const upload = require('../middlewares/upload');
const clientSelector = require('../middlewares/clientSelector');
const {sendMessage} = require('../controllers/messageController');
const { getChatsReportExposed } = require('../controllers/chatController');

router.post('/send-message', upload.single('file'), clientSelector, sendMessage);
router.get('/report', clientSelector, getChatsReportExposed);

module.exports = router;

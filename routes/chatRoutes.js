const express = require('express');
const router = express.Router();
const clientSelector = require('../middlewares/clientSelector');
const { getChatMessages, getChatsByLabels, getUnreadChats, getChatsReport } = require('../controllers/chatController');

// Get messages of a chat with pagination
router.post('/messages', clientSelector, getChatMessages);

// Get chats by labels
router.get('/by-labels', clientSelector, getChatsByLabels);

// Get all chats with unread messages
router.get('/unread', clientSelector, getUnreadChats);

// get a chat report
router.post('/report', clientSelector, getChatsReport);

module.exports = router;

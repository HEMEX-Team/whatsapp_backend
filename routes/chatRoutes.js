const express = require('express');
const router = express.Router();
const { getChatMessages, getChatsByLabels, getUnreadChats, getChatsReport } = require('../controllers/chatController');

// Get messages of a chat with pagination
router.post('/messages', getChatMessages);

// Get chats by labels
router.get('/by-labels', getChatsByLabels);

// Get all chats with unread messages
router.get('/unread', getUnreadChats);

// get a chat report
router.post('/report', getChatsReport);

module.exports = router;

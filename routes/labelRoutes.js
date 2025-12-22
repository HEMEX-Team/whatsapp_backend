const express = require('express');
const router = express.Router();
const { getLabels, getLabelById, getChatLabels, replaceChatLabels } = require('../controllers/labelController');

// Labels endpoints
router.get('/', getLabels); // Get all available labels
router.get('/chat', getChatLabels); // Get labels for a chat
router.get('/:labelId', getLabelById); // Get a specific label
router.put('/replace-labels', replaceChatLabels); // Update labels for chats

module.exports = router;

const express = require('express');
const router = express.Router();
const clientSelector = require('../middlewares/clientSelector');
const { getLabels, getLabelById, getChatLabels, replaceChatLabels } = require('../controllers/labelController');

// Labels endpoints
router.get('/', clientSelector, getLabels); // Get all available labels
router.get('/chat', clientSelector, getChatLabels); // Get labels for a chat
router.get('/:labelId', clientSelector, getLabelById); // Get a specific label
router.put('/replace-labels', clientSelector, replaceChatLabels); // Update labels for chats

module.exports = router;

const Chat = require("../models/Chat");
const { parsePhoneNumber, getChatId } = require("../utils/phoneUtils");
const { isClientReady } = require("../services/clientManager");
const {parseDDMMYYYY} = require('../utils/dateParser');
const path = require('path');
const fs = require('fs');
const { escapeCsvField } = require("../utils/csvInput");

// Get messages of a chat with pagination directly from WhatsApp
// Ex. { contactNumber: "201061261991" }
async function getChatMessages(req, res) {
  try {
    const client = req.client;
    const { limit = 10 } = req.query;
    const { contactNumber } = req.body;

    if (!contactNumber) {
      return res.status(400).json({
        success: false,
        message: "contactNumber is required",
      });
    }

    // Client ready check is handled by middleware
    try {
      const chatId = getChatId(contactNumber);

      // Fetch the chat
      const chat = await client.getChatById(chatId);

      if (!chat) {
        return res.status(404).json({
          success: false,
          message: "Chat not found",
        });
      }

      // Fetch messages with pagination
      const messages = await chat.fetchMessages({
        limit: parseInt(limit),
        // fromMe: false, // Set to true to include only your messages, false for all
      });

      // Process messages to include only needed fields
      const processedMessages = messages.map((msg) => ({
        id: msg.id.id,
        body: msg.body,
        fromMe: msg.fromMe,
        timestamp: msg.timestamp,
        hasMedia: msg.hasMedia,
        hasQuotedMsg: msg.hasQuotedMsg,
        type: msg.type,
        // Add more fields as needed
      }));

      res.json({
        success: true,
        messages: processedMessages,
      });
    } catch (error) {
      console.error("Error in getChatMessages:", error);
      throw error; // Will be caught by the outer catch block
    }
  } catch (error) {
    console.error("Error in getChatMessages:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching messages",
      error: error.message,
    });
  }
}

// Get chats by labels using WhatsApp API
async function getChatsByLabels(req, res) {
  try {
    const client = req.client;
    let { page, limit, labels, search } = req.query;

    // Convert labels to array if needed
    const labelIds = Array.isArray(labels)
      ? labels
      : typeof labels === "string"
      ? labels.split(",").filter(Boolean)
      : [];

    // Client ready check is handled by middleware

    try {
      let chats = [];

      if (labelIds.length === 0) {
        // If no labels specified, get all chats
        chats = await client.getChats();
      } else {
        // Get unique chats from all specified labels
        const chatSet = new Map();

        for (const labelId of labelIds) {
          try {
            const labelChats = await client.getChatsByLabelId(labelId);

            // Add chats to the map to ensure uniqueness
            for (const chat of labelChats) {
              if (!chatSet.has(chat.id._serialized)) {
                chatSet.set(chat.id._serialized, chat);
              }
            }
          } catch (error) {
            console.error(`Error getting chats for label ${labelId}:`, error);
            // Continue with other labels if one fails
          }
        }

        chats = Array.from(chatSet.values());
      }

      // Process chats to get required data
      const processedChats = [];

      for (const chat of chats) {
        try {
          const chatLabels = await chat.getLabels();
          const lastMessageContent = chat.lastMessage?.body?.toLowerCase() || '';
          const chatName = (chat.name || chat.id.user || "Unknown").toLowerCase();

          processedChats.push({
            id: chat.id._serialized,
            name: chat.name || chat.id.user || "Unknown",
            timestamp: chat.timestamp,
            unreadCount: chat.unreadCount,
            lastMessage: chat.lastMessage,
            labels: chatLabels.map((label) => ({
              id: label.id,
              name: label.name,
              hexColor: label.hexColor,
            })),
            // Store lowercase versions for search filtering
            _searchName: chatName,
            _searchId: chat.id._serialized,
            _searchLastMessage: lastMessageContent,
          });
        } catch (error) {
          console.error(`Error processing chat ${chat.id._serialized}:`, error);
          // Continue with other chats if one fails
        }
      }

      // Sort by timestamp (newest first)
      let sortedChats = processedChats.sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
      );

      // Apply search filter if search query is provided
      if (search && typeof search === 'string') {
        const searchQuery = search.toLowerCase();
        sortedChats = sortedChats.filter(chat => 
          chat._searchName.includes(searchQuery) || 
          chat._searchLastMessage.includes(searchQuery) ||
          chat._searchId.includes(searchQuery)
        );
      }

      // Remove temporary search properties before sending response
      const finalChats = sortedChats.map(chat => {
        const { _searchName, _searchLastMessage, ...rest } = chat;
        return rest;
      });

      // Apply pagination only if both page and limit are provided
      if (page && limit) {
        page = parseInt(page, 10) || 1;
        limit = parseInt(limit, 10) || 10;
        const skip = (page - 1) * limit;

        const paginatedChats = finalChats.slice(skip, skip + limit);

        return res.json({
          success: true,
          chats: paginatedChats,
          totalChats: finalChats.length,
          currentPage: page,
          totalPages: Math.ceil(finalChats.length / limit),
        });
      }

      // Return all chats if pagination is not requested
      res.json({
        success: true,
        chats: finalChats,
        totalChats: finalChats.length,
      });
    } catch (error) {
      console.error("Error in getChatsByLabels:", error);
      throw error; // Will be caught by the outer catch block
    }
  } catch (error) {
    console.error("Error in getChatsByLabels:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching chats by labels",
      error: error.message,
    });
  }
}

/**
 * Get all chats with unread messages along with their latest message and other details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getUnreadChats(req, res) {
  try {
    const client = req.client;
    
    // Client ready check is handled by middleware
    
    // Get all chats
    const allChats = await client.getChats();
    
    // Filter chats with unread messages and map to include only needed data
    const unreadChats = await Promise.all(
      allChats
        .filter(chat => chat.unreadCount > 0)
        .map(async (chat) => {

          // skip group chats
          if (chat.isGroup) {
            return null;
          }
          // Get the latest message
          const messages = await chat.fetchMessages({ limit: 1 });
          const latestMessage = messages.length > 0 ? messages[0] : null;
          
          // Get chat labels
          const labels = await chat.getLabels();
          
          return {
            id: chat.id._serialized,
            contactNumber: chat.id.user,
            name: chat.name || chat.id.user,
            timestamp: chat.timestamp,
            unreadCount: chat.unreadCount,
            labels: labels.map(label => ({
              id: label.id,
              name: label.name,
              hexColor: label.hexColor
            })),
            latestMessage: latestMessage ? {
              id: latestMessage.id.id,
              body: latestMessage.body || (latestMessage.hasMedia ? '[Media]' : ''),
              hasMedia: latestMessage.hasMedia,
              timestamp: latestMessage.timestamp,
              type: latestMessage.type
            } : null
          };
        })
    );

    // Sort by timestamp in descending order (newest first)
    unreadChats.sort((a, b) => b.timestamp - a.timestamp);

    return res.status(200).json({
      success: true,
      count: unreadChats.length,
      chats: unreadChats
    });

  } catch (error) {
    console.error('Error fetching unread chats:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch unread chats',
      error: error.message
    });
  }
}

async function getChatsReport(req, res) {
  try{
    const client = req.client;
    const { start_date, end_date } = req.body;
    
    // Validate presence of both dates
    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: "Both start_date and end_date are required in the request body.",
      });
    }

    const parsedStart = parseDDMMYYYY(start_date);
    const parsedEnd = parseDDMMYYYY(end_date);

    if (!parsedStart || !parsedEnd) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Please provide valid start_date and end_date in DD-MM-YYYY format.",
      });
    }

    // Get all chats
    const allChats = await client.getChats();

    // Fetch all available labels from the WhatsApp client
    const availableLabels = await client.getLabels(); 
    const labelColumns = availableLabels.map(label => label.name);

    // Prepare CSV header
    const csvHeader = [
      'Name',
      'Phone No.',
      ...labelColumns,
      'Last Message Sent',
      'Last Message Sent Date',
      'Last Message Received',
      'Last Message Received Date'
    ];

    // Prepare CSV rows
    const csvRows = [csvHeader.join(',')];

    for (const chat of allChats) {
      if(chat.isGroup) continue; // Skip group chats
      // Only process chats within the date range
      const chatTimestamp = new Date(chat.timestamp * 1000); // WhatsApp timestamps are in seconds
      if (chatTimestamp < parsedStart || chatTimestamp > parsedEnd) continue;

      // Get labels for this chat
      const labels = await chat.getLabels();
      const labelPresence = labelColumns.map(col =>
        labels.some(label => label.name === col) ? '1' : ''
      );

      // Fetch last sent and received messages
      const messages = await chat.fetchMessages({ limit: 20 }); // adjust limit as needed
      let lastSent = null, lastSentDate = '', lastReceived = null, lastReceivedDate = '';

      for (const msg of messages) {
        const msgDate = new Date(msg.timestamp * 1000);
        if (msgDate < parsedStart || msgDate > parsedEnd) continue;
        const msgBody = msg.hasMedia ? 'media' : msg.body;
        if (msg.fromMe) {
          if (!lastSent || msgDate > new Date(lastSentDate)) {
            lastSent = msgBody;
            lastSentDate = msgDate.toISOString();
          }
        } else {
          if (!lastReceived || msgDate > new Date(lastReceivedDate)) {
            lastReceived = msgBody;
            lastReceivedDate = msgDate.toISOString();
          }
        }
      }

      csvRows.push([
        escapeCsvField(chat.name || 'Unknown'), // <-- prefix with single quote
        escapeCsvField("'" + (chat.id.user || 'Unknown')), // <-- prefix with single quote
        ...labelPresence,
        escapeCsvField(lastSent || ''),
        escapeCsvField(lastSentDate),
        escapeCsvField(lastReceived || ''),
        escapeCsvField(lastReceivedDate)
      ].join(','));
    }

    // Save CSV file
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const fileName = `report_${start_date}_${end_date}.csv`;
    const filePath = path.join(uploadsDir, fileName);

    // Write with BOM for UTF-8
    const BOM = '\uFEFF';
    fs.writeFileSync(filePath, BOM + csvRows.join('\n'), 'utf8');

    return res.json({
      success: true,
      message: 'Report generated successfully',
      file: `/uploads/${fileName}`
    });



}catch (error) {
    console.error("Error in getChatsReport:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate chat report",
      error: error.message,
    });
  }

}

async function getChatsReportExposed(req, res) {
  try{
    const client = req.client;
    const { start_date, end_date } = req.query;
    
    // Validate presence of both dates
    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        message: "Both start_date and end_date are required as query parameters.",
      });
    }

    const parsedStart = parseDDMMYYYY(start_date);
    const parsedEnd = parseDDMMYYYY(end_date);

    if (!parsedStart || !parsedEnd) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format. Please provide valid start_date and end_date in DD-MM-YYYY format.",
      });
    }

    // Get all chats
    const allChats = await client.getChats();

    // Fetch all available labels from the WhatsApp client
    const availableLabels = await client.getLabels(); 
    const labelColumns = availableLabels.map(label => label.name);

    // Prepare CSV header
    const csvHeader = [
      'Name',
      'Phone No.',
      ...labelColumns,
      'Last Message Sent',
      'Last Message Sent Date',
      'Last Message Received',
      'Last Message Received Date'
    ];

    // Prepare CSV rows
    const csvRows = [csvHeader.join(',')];

    for (const chat of allChats) {
      if(chat.isGroup) continue; // Skip group chats
      // Only process chats within the date range
      const chatTimestamp = new Date(chat.timestamp * 1000); // WhatsApp timestamps are in seconds
      if (chatTimestamp < parsedStart || chatTimestamp > parsedEnd) continue;

      // Get labels for this chat
      const labels = await chat.getLabels();
      const labelPresence = labelColumns.map(col =>
        labels.some(label => label.name === col) ? '1' : ''
      );

      // Fetch last sent and received messages
      const messages = await chat.fetchMessages({ limit: 20 }); // adjust limit as needed
      let lastSent = null, lastSentDate = '', lastReceived = null, lastReceivedDate = '';

      for (const msg of messages) {
        const msgDate = new Date(msg.timestamp * 1000);
        if (msgDate < parsedStart || msgDate > parsedEnd) continue;
        const msgBody = msg.hasMedia ? 'media' : msg.body;
        if (msg.fromMe) {
          if (!lastSent || msgDate > new Date(lastSentDate)) {
            lastSent = msgBody;
            lastSentDate = msgDate.toISOString();
          }
        } else {
          if (!lastReceived || msgDate > new Date(lastReceivedDate)) {
            lastReceived = msgBody;
            lastReceivedDate = msgDate.toISOString();
          }
        }
      }

      csvRows.push([
        escapeCsvField(chat.name || 'Unknown'),
        escapeCsvField("'" + (chat.id.user || 'Unknown')),
        ...labelPresence,
        escapeCsvField(lastSent || ''),
        escapeCsvField(lastSentDate),
        escapeCsvField(lastReceived || ''),
        escapeCsvField(lastReceivedDate)
      ].join(','));
    }

    // Generate CSV content with BOM for UTF-8
    const BOM = '\uFEFF';
    const csvContent = BOM + csvRows.join('\n');
    const fileName = `report_${start_date}_${end_date}.csv`;

    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    // Stream the CSV file directly
    return res.send(csvContent);

  } catch (error) {
    console.error("Error in getChatsReportExposed:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate chat report",
      error: error.message,
    });
  }
}

module.exports = {
  getChatMessages,
  getChatsByLabels,
  getUnreadChats,
  getChatsReport,
  getChatsReportExposed
};

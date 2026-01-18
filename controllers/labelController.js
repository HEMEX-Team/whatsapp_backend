const Chat = require('../models/Chat');

// Get all available labels
async function getLabels(req, res) {
  try {
    const client = req.client;
    const labels = await client.getLabels();
    res.json({ labels });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching labels', error: error.message });
  }
}

async function getLabelById(req, res) {
  try {
    const client = req.client;
    const { labelId } = req.params;
    if (!labelId) {
      return res.status(400).json({ message: 'Label ID is required' });
    }
    const label = await client.getLabelById(labelId);
    res.json({ label });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching label', error: error.message });
  }
}

// Get labels for a specific contact
// chatId format : 201088899963@c.us
async function getChatLabels(req, res) {
  try {
    const client = req.client;
    const { chatId } = req.body;
    
    if (!chatId) {
      return res.status(400).json({ 
        success: false,
        message: 'chatId is required' 
      });
    }

    try {
      // Client ready check is handled by middleware
      
      const labels = await client.getChatLabels(chatId);
      res.json({ 
        success: true,
        labels 
      });
    } catch (error) {
      console.error('Error in getChatLabels:', error);
      
      // Note: Client reinitialization should be handled by client manager
      // This is a connection error that may require client restart
      
      throw error; // Re-throw if not a navigation error
    }
  } catch (error) {
    console.error('Error in getChatLabels:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching contact labels', 
      error: error.message 
    });
  }
}

// Update labels for a contact using WhatsApp API only
async function replaceChatLabels(req, res) {

  try {
    const client = req.client;
    const { chatIds = [], labelIds = [] } = req.body;
    
    if (!Array.isArray(chatIds) || chatIds.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: 'At least one chatId is required' 
      });
    }
    
    // Convert label IDs to strings for consistent comparison
    const newLabelIds = Array.isArray(labelIds) ? labelIds.map(String) : [];
    let successCount = 0;
    
    // Process each chat to update its labels
    for (const chatId of chatIds) {
      try {
        console.log(chatId)
        // Get current labels from WhatsApp
        const existingLabels = await client.getChatLabels(chatId);
        console.log("existingLabels",existingLabels)
        const existingLabelIds = existingLabels?.map(label => label.id) || [];
        console.log("existingLabelIds",existingLabelIds)
        // If newLabelIds is empty, remove all labels
        if (newLabelIds.length === 0) {
          // Remove all existing labels
          if (existingLabelIds.length > 0) {
            await client.addOrRemoveLabels(existingLabelIds, [chatId]);
          }
        } else {
          // Remove labels that are not in the new labels
          const labelsToRemove = existingLabelIds.filter(id => !newLabelIds.includes(id));
          console.log("labelsToRemove",labelsToRemove)
          if (labelsToRemove.length > 0) {
            await client.addOrRemoveLabels(labelsToRemove, [chatId]);
          }
          
          // Add new labels that don't exist
          const labelsToAdd = newLabelIds.filter(id => !existingLabelIds.includes(id));
          console.log("labelsToAdd",labelsToAdd)
          if (labelsToAdd.length > 0) {
            await client.addOrRemoveLabels(labelsToAdd, [chatId]);
          }
        }
        
        successCount++;
        
      } catch (error) {
        console.error(`Error updating labels for chat ${chatId}:`, error);
        // Continue with other chats even if one fails
      }
    }

    res.json({ 
      success: true,
      message: 'Contact labels updated successfully',
      updatedChats: successCount,
      totalRequested: chatIds.length
    });
    
  } catch (error) {
    console.error('Error in toggleChatLabels:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error updating contact labels', 
      error: error.message 
    });
  }
}

module.exports = {
  getLabels,
  getLabelById,
  getChatLabels,
  replaceChatLabels
};

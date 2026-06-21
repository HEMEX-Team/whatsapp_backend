// Get all available labels
async function getLabels(req, res) {
  try {
    const client = req.whatsappClient;
    const labels = await client.getLabels();
    res.json({ labels });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching labels', error: error.message });
  }
}

async function getLabelById(req, res) {
  try {
    const client = req.whatsappClient;
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
    const client = req.whatsappClient;
    const { chatId } = req.body;
    
    if (!chatId) {
      return res.status(400).json({ 
        success: false,
        message: 'chatId is required' 
      });
    }

    try {
      const labels = await client.getChatLabels(chatId);
      res.json({ 
        success: true,
        labels 
      });
    } catch (error) {
      console.error('Error in getChatLabels:', error);
      
      if (error.message.includes('Execution context was destroyed') ||
          error.message.includes('Navigation failed') ||
          error.message.includes('Protocol error')) {
        try {
          await client.initialize();
          const labels = await client.getChatLabels(chatId);
          return res.json({ 
            success: true,
            labels,
            recovered: true
          });
        } catch (retryError) {
          console.error('Recovery attempt failed:', retryError);
          throw new Error('Failed to recover from navigation error');
        }
      }
      
      throw error;
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
    const client = req.whatsappClient;
    const { chatIds = [], labelIds = [] } = req.body;
    
    if (!Array.isArray(chatIds) || chatIds.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: 'At least one chatId is required' 
      });
    }
    
    const newLabelIds = Array.isArray(labelIds) ? labelIds.map(String) : [];
    let successCount = 0;
    
    for (const chatId of chatIds) {
      try {
        const existingLabels = await client.getChatLabels(chatId);
        const existingLabelIds = existingLabels?.map(label => label.id) || [];
        if (newLabelIds.length === 0) {
          if (existingLabelIds.length > 0) {
            await client.addOrRemoveLabels(existingLabelIds, [chatId]);
          }
        } else {
          const labelsToRemove = existingLabelIds.filter(id => !newLabelIds.includes(id));
          if (labelsToRemove.length > 0) {
            await client.addOrRemoveLabels(labelsToRemove, [chatId]);
          }
          
          const labelsToAdd = newLabelIds.filter(id => !existingLabelIds.includes(id));
          if (labelsToAdd.length > 0) {
            await client.addOrRemoveLabels(labelsToAdd, [chatId]);
          }
        }
        
        successCount++;
        
      } catch (error) {
        console.error(`Error updating labels for chat ${chatId}:`, error);
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

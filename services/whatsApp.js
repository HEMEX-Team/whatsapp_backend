/**
 * WhatsApp Service
 * 
 * This module now exports client manager functions for multi-client support.
 * For backward compatibility, it also provides access to client manager.
 * 
 * @deprecated Direct client usage is deprecated. Use clientManager instead.
 */

const clientManager = require('./clientManager');

// Export client manager functions directly
module.exports = {
  // Client manager functions
  getClient: clientManager.getClient,
  getAllClients: clientManager.getAllClients,
  initializeClient: clientManager.initializeClient,
  removeClient: clientManager.removeClient,
  getClientStatus: clientManager.getClientStatus,
  isClientReady: clientManager.isClientReady,
  
  // Legacy exports for backward compatibility (deprecated)
  // These will be removed in a future version
  // Use clientManager.getClient() with a specific phone number instead
  get client() {
    console.warn('[DEPRECATED] Direct access to client is deprecated. Use clientManager.getClient(phoneNumber) instead.');
    return null;
  },
  isReady() {
    console.warn('[DEPRECATED] Direct isReady() is deprecated. Use clientManager.isClientReady(phoneNumber) instead.');
    return false;
  }
};

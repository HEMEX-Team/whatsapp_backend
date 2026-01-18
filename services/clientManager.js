require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const ClientModel = require('../models/Client');

// In-memory storage for active client instances
const clientsMap = new Map(); // Map<phoneNumber, {client, isReady, qrCode}>

/**
 * Get or create a WhatsApp client instance for a phone number
 * @param {string} phoneNumber - Phone number identifying the client
 * @returns {Promise<Object>} Client instance and metadata
 */
async function getClient(phoneNumber) {
  // Normalize phone number (remove + and spaces)
  const normalizedPhone = phoneNumber.replace(/[+\s]/g, '');
  
  // Check if client already exists in memory
  if (clientsMap.has(normalizedPhone)) {
    const clientData = clientsMap.get(normalizedPhone);
    return {
      client: clientData.client,
      isReady: clientData.isReady,
      qrCode: clientData.qrCode,
      phoneNumber: normalizedPhone
    };
  }

  // Check if client exists in database
  let clientDoc = await ClientModel.findOne({ phoneNumber: normalizedPhone });
  
  if (!clientDoc) {
    // Create new client document
    clientDoc = new ClientModel({
      phoneNumber: normalizedPhone,
      status: 'initializing'
    });
    await clientDoc.save();
  }

  // Create new client instance
  const clientData = await initializeClient(normalizedPhone);
  return clientData;
}

/**
 * Initialize a new WhatsApp client instance
 * @param {string} phoneNumber - Phone number identifying the client
 * @returns {Promise<Object>} Client instance and metadata
 */
async function initializeClient(phoneNumber) {
  const normalizedPhone = phoneNumber.replace(/[+\s]/g, '');
  
  // If client already exists, return it
  if (clientsMap.has(normalizedPhone)) {
    return clientsMap.get(normalizedPhone);
  }

  // Create unique data path for this client
  const dataPath = path.join(process.cwd(), 'wwebjs_cache', normalizedPhone);
  
  // Create client instance
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: `whatsapp-client-${normalizedPhone}`,
      dataPath: dataPath
    }),
    puppeteer: {
      executablePath: process.env.CHROMIUM_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true
    }
  });

  let isReady = false;
  let qrCode = null;

  // Handle QR code generation
  client.on('qr', async (qr) => {
    try {
      console.log(`[Client ${normalizedPhone}] QR Code generated`);
      qrCode = qr;
      
      // Update database with QR code
      try {
        await ClientModel.findOneAndUpdate(
          { phoneNumber: normalizedPhone },
          { 
            qrCode: qr,
            status: 'initializing',
            updatedAt: new Date()
          }
        );
      } catch (dbError) {
        console.error(`[Client ${normalizedPhone}] Error updating database with QR code:`, dbError.message);
      }

      // Store in memory
      if (clientsMap.has(normalizedPhone)) {
        clientsMap.get(normalizedPhone).qrCode = qr;
      }
    } catch (error) {
      console.error(`[Client ${normalizedPhone}] Error handling QR code:`, error.message);
      // Don't throw - just log the error
    }
  });

  // Handle client ready state
  client.on('ready', async () => {
    try {
      console.log(`[Client ${normalizedPhone}] WhatsApp Web is ready`);
      isReady = true;
      
      // Update database
      try {
        await ClientModel.findOneAndUpdate(
          { phoneNumber: normalizedPhone },
          { 
            status: 'active',
            lastConnected: new Date(),
            updatedAt: new Date()
          }
        );
      } catch (dbError) {
        console.error(`[Client ${normalizedPhone}] Error updating database on ready:`, dbError.message);
      }

      // Update in memory
      if (clientsMap.has(normalizedPhone)) {
        clientsMap.get(normalizedPhone).isReady = true;
      }
    } catch (error) {
      console.error(`[Client ${normalizedPhone}] Error handling ready state:`, error.message);
      // Don't throw - just log the error
    }
  });

  // Handle authentication failure
  client.on('auth_failure', async (msg) => {
    try {
      console.error(`[Client ${normalizedPhone}] Authentication failure:`, msg);
      
      try {
        await ClientModel.findOneAndUpdate(
          { phoneNumber: normalizedPhone },
          { 
            status: 'inactive',
            updatedAt: new Date()
          }
        );
      } catch (dbError) {
        console.error(`[Client ${normalizedPhone}] Error updating database on auth failure:`, dbError.message);
      }
      
      if (clientsMap.has(normalizedPhone)) {
        clientsMap.get(normalizedPhone).isReady = false;
      }
    } catch (error) {
      console.error(`[Client ${normalizedPhone}] Error handling auth failure:`, error.message);
      // Don't throw - just log the error
    }
  });

  // Handle disconnection
  client.on('disconnected', async (reason) => {
    try {
      console.log(`[Client ${normalizedPhone}] Disconnected:`, reason);
      
      // Update database
      try {
        await ClientModel.findOneAndUpdate(
          { phoneNumber: normalizedPhone },
          { 
            status: 'inactive',
            updatedAt: new Date()
          }
        );
      } catch (dbError) {
        console.error(`[Client ${normalizedPhone}] Error updating database on disconnect:`, dbError.message);
      }
      
      // Update memory
      if (clientsMap.has(normalizedPhone)) {
        clientsMap.get(normalizedPhone).isReady = false;
      }
    } catch (error) {
      console.error(`[Client ${normalizedPhone}] Error handling disconnection:`, error.message);
      // Don't throw - just log the error
    }
  });

  // Handle any unhandled errors from the client
  client.on('error', (error) => {
    console.error(`[Client ${normalizedPhone}] Unhandled error:`, error.message);
    // Don't throw - just log the error
  });

  // Store client data in memory
  const clientData = {
    client,
    isReady,
    qrCode,
    phoneNumber: normalizedPhone
  };
  clientsMap.set(normalizedPhone, clientData);

  // Initialize the client if not already initialized
  if (!client.isInitialized) {
    try {
      await client.initialize();
    } catch (error) {
      console.error(`[Client ${normalizedPhone}] Error initializing:`, error);
      throw error;
    }
  }

  return clientData;
}

/**
 * Get all registered clients
 * @returns {Promise<Array>} Array of client information
 */
async function getAllClients() {
  try {
    // Get clients from database
    const dbClients = await ClientModel.find({}).sort({ createdAt: -1 });
    
    // Get all clients from memory (might have clients not yet in DB)
    const memoryClients = Array.from(clientsMap.keys());
    
    // Create a map of all unique phone numbers
    const allPhoneNumbers = new Set();
    dbClients.forEach(client => allPhoneNumbers.add(client.phoneNumber));
    memoryClients.forEach(phone => allPhoneNumbers.add(phone));
    
    // Build enriched client list
    const enrichedClients = [];
    
    for (const phoneNumber of allPhoneNumbers) {
      const clientDoc = dbClients.find(c => c.phoneNumber === phoneNumber);
      const inMemoryData = clientsMap.get(phoneNumber);
      
      // If client exists in memory but not in DB, create a DB entry
      if (inMemoryData && !clientDoc) {
        try {
          const newClientDoc = new ClientModel({
            phoneNumber: phoneNumber,
            status: inMemoryData.isReady ? 'active' : 'initializing',
            lastConnected: inMemoryData.isReady ? new Date() : undefined,
          });
          await newClientDoc.save();
          
          enrichedClients.push({
            phoneNumber: phoneNumber,
            name: newClientDoc.name,
            status: inMemoryData.isReady ? 'active' : newClientDoc.status,
            lastConnected: newClientDoc.lastConnected,
            createdAt: newClientDoc.createdAt,
            updatedAt: newClientDoc.updatedAt,
            isReady: inMemoryData.isReady || false
          });
        } catch (error) {
          console.error(`[getAllClients] Error creating DB entry for ${phoneNumber}:`, error);
          // Add client from memory anyway
          enrichedClients.push({
            phoneNumber: phoneNumber,
            name: undefined,
            status: inMemoryData.isReady ? 'active' : 'initializing',
            lastConnected: undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
            isReady: inMemoryData.isReady || false
          });
        }
      } else if (clientDoc) {
        // Client exists in DB, enrich with memory status
        enrichedClients.push({
          phoneNumber: clientDoc.phoneNumber,
          name: clientDoc.name,
          status: inMemoryData?.isReady ? 'active' : clientDoc.status,
          lastConnected: clientDoc.lastConnected,
          createdAt: clientDoc.createdAt,
          updatedAt: clientDoc.updatedAt,
          isReady: inMemoryData?.isReady || false
        });
      }
    }
    
    // Sort by created date (newest first)
    enrichedClients.sort((a, b) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
    
    console.log(`[getAllClients] Found ${enrichedClients.length} clients (${dbClients.length} from DB, ${memoryClients.length} in memory)`);
    
    return enrichedClients;
  } catch (error) {
    console.error('[getAllClients] Error:', error);
    // Fallback: return clients from memory if DB query fails
    const fallbackClients = Array.from(clientsMap.entries()).map(([phoneNumber, data]) => ({
      phoneNumber: phoneNumber,
      name: undefined,
      status: data.isReady ? 'active' : 'initializing',
      lastConnected: undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
      isReady: data.isReady || false
    }));
    console.log(`[getAllClients] Fallback: returning ${fallbackClients.length} clients from memory`);
    return fallbackClients;
  }
}

/**
 * Get client status
 * @param {string} phoneNumber - Phone number identifying the client
 * @returns {Promise<Object>} Client status information
 */
async function getClientStatus(phoneNumber) {
  const normalizedPhone = phoneNumber.replace(/[+\s]/g, '');
  
  const clientDoc = await ClientModel.findOne({ phoneNumber: normalizedPhone });
  if (!clientDoc) {
    return null;
  }

  const inMemoryData = clientsMap.get(normalizedPhone);
  
  return {
    phoneNumber: clientDoc.phoneNumber,
    name: clientDoc.name,
    status: inMemoryData?.isReady ? 'active' : clientDoc.status,
    isReady: inMemoryData?.isReady || false,
    lastConnected: clientDoc.lastConnected,
    createdAt: clientDoc.createdAt,
    updatedAt: clientDoc.updatedAt,
    hasQrCode: !!clientDoc.qrCode
  };
}

/**
 * Remove a client and cleanup resources
 * @param {string} phoneNumber - Phone number identifying the client
 * @returns {Promise<boolean>} Success status
 */
async function removeClient(phoneNumber) {
  const normalizedPhone = phoneNumber.replace(/[+\s]/g, '');
  
  // Get client from memory
  const clientData = clientsMap.get(normalizedPhone);
  
  if (clientData) {
    try {
      // Destroy the client
      if (clientData.client && clientData.client.isInitialized) {
        try {
          await clientData.client.destroy();
        } catch (destroyError) {
          console.error(`[Client ${normalizedPhone}] Error destroying client:`, destroyError.message);
          // Continue even if destroy fails - the client will be cleaned up eventually
        }
      }
      
      // Try to logout (clean up auth files)
      if (clientData.client) {
        try {
          await clientData.client.logout();
        } catch (logoutError) {
          // Ignore logout errors - they often happen when files are locked
          // This is especially common on Windows
          console.warn(`[Client ${normalizedPhone}] Warning during logout (can be safely ignored):`, logoutError.message);
        }
      }
    } catch (error) {
      console.error(`[Client ${normalizedPhone}] Error in removeClient cleanup:`, error.message);
      // Don't throw - continue with removal
    }
    
    // Remove from memory
    clientsMap.delete(normalizedPhone);
  }

  // Remove from database
  await ClientModel.findOneAndDelete({ phoneNumber: normalizedPhone });
  
  return true;
}

/**
 * Check if a client is ready
 * @param {string} phoneNumber - Phone number identifying the client
 * @returns {boolean} True if client is ready
 */
function isClientReady(phoneNumber) {
  const normalizedPhone = phoneNumber.replace(/[+\s]/g, '');
  const clientData = clientsMap.get(normalizedPhone);
  return clientData ? (clientData.isReady && !!clientData.client.pupPage) : false;
}

module.exports = {
  getClient,
  getAllClients,
  initializeClient,
  removeClient,
  getClientStatus,
  isClientReady
};

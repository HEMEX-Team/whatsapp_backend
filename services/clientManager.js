require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const ClientModel = require('../models/Client');
const { resolveChromiumPath } = require('../config/browserPath');
const { debugLog } = require('../utils/debugLog');

const clientsMap = new Map();
const initLocks = new Map();
const qrEventCounts = new Map();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return UUID_REGEX.test(value);
}

function normalizePhone(phoneNumber) {
  return phoneNumber.replace(/[+\s]/g, '');
}

function getPuppeteerConfig() {
  return {
    executablePath: resolveChromiumPath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true,
    protocolTimeout: 120000
  };
}

async function migrateExistingClients() {
  const clients = await ClientModel.find({
    $or: [{ deviceId: { $exists: false } }, { deviceId: null }, { deviceId: '' }]
  });

  for (const doc of clients) {
    if (doc.phoneNumber) {
      doc.deviceId = doc.phoneNumber;
      await doc.save();
    }
  }
}

async function findClientDoc(identifier) {
  const trimmed = String(identifier).trim();

  if (isUuid(trimmed)) {
    return ClientModel.findOne({ deviceId: trimmed });
  }

  const normalizedPhone = normalizePhone(trimmed);
  if (/^\d+$/.test(normalizedPhone)) {
    const byPhone = await ClientModel.findOne({ phoneNumber: normalizedPhone });
    if (byPhone) return byPhone;
  }

  return ClientModel.findOne({ deviceId: trimmed });
}

async function probeOperationalReady(client) {
  if (!client?.pupPage) return false;
  try {
    await client.getChats();
    return true;
  } catch (error) {
    // #region agent log
    debugLog('clientManager.js:probeOperationalReady', 'getChats probe failed', {
      error: error?.message || String(error)
    }, 'H11');
    // #endregion
    return false;
  }
}

function clearOperationalReady(deviceId) {
  const inMemoryData = clientsMap.get(deviceId);
  if (!inMemoryData) return;
  inMemoryData.isReady = false;
  clientsMap.set(deviceId, inMemoryData);
}

function buildStatusResponse(clientDoc, inMemoryData) {
  const operationalReady = !!(inMemoryData?.isReady);
  const dbPaired =
    clientDoc.status === 'active' &&
    (!!clientDoc.phoneNumber || clientDoc.needsName || !!clientDoc.name);
  const isReady = operationalReady;

  return {
    deviceId: clientDoc.deviceId,
    phoneNumber: clientDoc.phoneNumber,
    name: clientDoc.name,
    status: isReady ? 'active' : clientDoc.status,
    isReady,
    needsName: clientDoc.needsName || false,
    pairingError: clientDoc.pairingError || null,
    lastConnected: clientDoc.lastConnected,
    createdAt: clientDoc.createdAt,
    updatedAt: clientDoc.updatedAt,
    hasQrCode: !!clientDoc.qrCode
  };
}

async function createClientInstance(deviceId) {
  // #region agent log
  debugLog('clientManager.js:createClientInstance', 'creating client instance', {
    deviceId,
    clientsMapSize: clientsMap.size,
    hasLock: initLocks.has(deviceId),
    existingIds: [...clientsMap.keys()]
  }, 'H1');
  // #endregion

  const clientDoc = await ClientModel.findOne({ deviceId });
  if (!clientDoc) {
    throw new Error(`Client document not found for deviceId ${deviceId}`);
  }

  const dataPath = path.join(process.cwd(), 'wwebjs_cache', deviceId);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: `whatsapp-client-${deviceId}`,
      dataPath
    }),
    puppeteer: getPuppeteerConfig(),
    authTimeoutMs: 120000,
    qrMaxRetries: 0
  });

  let readyHandled = false;
  let authHandled = false;

  const updateDb = async (update) => {
    await ClientModel.findOneAndUpdate(
      { deviceId },
      { ...update, updatedAt: new Date() }
    );
  };

  const clientData = {
    client,
    isReady: false,
    qrCode: null,
    deviceId,
    phoneNumber: clientDoc.phoneNumber || null
  };

  const syncMemory = (patch) => {
    Object.assign(clientData, patch);
    clientsMap.set(deviceId, clientData);
  };

  const finalizePairing = async (source) => {
    const currentDoc = await ClientModel.findOne({ deviceId });
    if (currentDoc?.status === 'active' && currentDoc?.phoneNumber && currentDoc?.name) {
      return currentDoc;
    }

    let phoneNumber = clientData.phoneNumber;
    let realPhone = null;
    try {
      realPhone = client.info?.wid?.user;
    } catch {
      realPhone = null;
    }

    const needsName = !currentDoc?.name;
    const update = {
      status: 'active',
      needsName,
      pairingError: null,
      qrCode: null,
      lastConnected: new Date()
    };

    if (realPhone) {
      const normalizedRealPhone = normalizePhone(realPhone);
      const duplicate = await ClientModel.findOne({
        phoneNumber: normalizedRealPhone,
        deviceId: { $ne: deviceId }
      });

      if (duplicate) {
        console.warn(
          `[Client ${deviceId}] Replacing previous device for phone ${normalizedRealPhone}`
        );
        await removeClient(duplicate.deviceId);
      }

      update.phoneNumber = normalizedRealPhone;
      phoneNumber = normalizedRealPhone;
    }

    await updateDb(update);
    syncMemory({
      phoneNumber,
      qrCode: null,
      ...(source === 'ready' ? { isReady: true } : {})
    });

    const afterDoc = await ClientModel.findOne({ deviceId });
    // #region agent log
    debugLog('clientManager.js:finalizePairing', 'pairing finalized', {
      deviceId,
      source,
      hasPhone: !!afterDoc?.phoneNumber,
      status: afterDoc?.status,
      needsName: afterDoc?.needsName,
      memoryReady: source === 'ready',
      hasPupPage: !!client.pupPage
    }, 'H4');
    // #endregion
    return afterDoc;
  };

  const scheduleOperationalReady = () => {
    const wait = async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        if (clientData.isReady) {
          return;
        }

        const operational = await probeOperationalReady(client);
        if (operational) {
          syncMemory({ isReady: true });
          // #region agent log
          debugLog('clientManager.js:operationalReady', 'store became operational', {
            deviceId,
            attempt
          }, 'H10');
          // #endregion
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // #region agent log
      debugLog('clientManager.js:operationalReady', 'store probe timed out', {
        deviceId
      }, 'H10');
      // #endregion
    };

    wait().catch(() => {});
  };

  const schedulePhoneCapture = () => {
    const capture = async () => {
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          const phone = client.info?.wid?.user;
          if (phone) {
            const normalized = normalizePhone(phone);
            const doc = await ClientModel.findOne({ deviceId });
            if (doc?.phoneNumber === normalized) {
              return;
            }

            const duplicate = await ClientModel.findOne({
              phoneNumber: normalized,
              deviceId: { $ne: deviceId }
            });
            if (duplicate) {
              console.warn(
                `[Client ${deviceId}] Replacing previous device for phone ${normalized}`
              );
              await removeClient(duplicate.deviceId);
            }

            await updateDb({ phoneNumber: normalized });
            syncMemory({ phoneNumber: normalized });
            // #region agent log
            debugLog('clientManager.js:phoneCapture', 'phone captured', {
              deviceId,
              attempt
            }, 'H9');
            // #endregion
            return;
          }
        } catch {
          /* client.info not available yet */
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    };

    capture().catch(() => {});
  };

  client.on('qr', async (qr) => {
    try {
      const doc = await ClientModel.findOne({ deviceId });
      if (doc?.status === 'active') {
        return;
      }

      console.log(`[Client ${deviceId}] QR Code generated`);
      const qrCount = (qrEventCounts.get(deviceId) || 0) + 1;
      qrEventCounts.set(deviceId, qrCount);
      // #region agent log
      debugLog('clientManager.js:qr', 'qr event', {
        deviceId,
        qrCount,
        dbStatus: doc?.status,
        hasPhone: !!doc?.phoneNumber
      }, 'H2');
      // #endregion
      syncMemory({ qrCode: qr });
      await updateDb({ qrCode: qr, status: 'initializing', pairingError: null });
    } catch (error) {
      console.error(`[Client ${deviceId}] Error handling QR code:`, error.message);
    }
  });

  client.on('authenticated', async () => {
    if (authHandled) return;
    authHandled = true;

    try {
      console.log(`[Client ${deviceId}] Authenticated`);
      const doc = await finalizePairing('authenticated');
      scheduleOperationalReady();
      if (!doc?.phoneNumber) {
        schedulePhoneCapture();
      }
    } catch (error) {
      authHandled = false;
      console.error(`[Client ${deviceId}] Error handling authenticated:`, error.message);
      await updateDb({ status: 'inactive', pairingError: error.message });
    }
  });

  client.on('ready', async () => {
    if (readyHandled) return;
    readyHandled = true;

    try {
      console.log(`[Client ${deviceId}] WhatsApp Web is ready`);
      const doc = await finalizePairing('ready');
      if (!doc?.phoneNumber) {
        schedulePhoneCapture();
      }
    } catch (error) {
      readyHandled = false;
      console.error(`[Client ${deviceId}] Error handling ready state:`, error.message);
      await updateDb({
        status: 'inactive',
        pairingError: error.message
      });
    }
  });

  client.on('auth_failure', async (msg) => {
    try {
      console.error(`[Client ${deviceId}] Authentication failure:`, msg);
      await updateDb({ status: 'inactive', pairingError: String(msg) });
      syncMemory({ isReady: false });
    } catch (error) {
      console.error(`[Client ${deviceId}] Error handling auth failure:`, error.message);
    }
  });

  client.on('disconnected', async (reason) => {
    try {
      console.log(`[Client ${deviceId}] Disconnected:`, reason);
      const doc = await ClientModel.findOne({ deviceId });
      // #region agent log
      debugLog('clientManager.js:disconnected', 'disconnected event', {
        deviceId,
        reason: String(reason),
        dbStatus: doc?.status,
        hasPhone: !!doc?.phoneNumber,
        needsName: doc?.needsName,
        qrCount: qrEventCounts.get(deviceId) || 0
      }, 'H2');
      // #endregion

      if (doc?.status === 'active' && (doc?.phoneNumber || doc?.needsName)) {
        syncMemory({ isReady: false });
        return;
      }

      const reasonStr = String(reason);
      if (reasonStr.includes('Max qrcode retries')) {
        await updateDb({ status: 'inactive', pairingError: reasonStr, qrCode: null });
        syncMemory({ isReady: false, qrCode: null });
        clientsMap.delete(deviceId);
        qrEventCounts.delete(deviceId);
        return;
      }

      await updateDb({ status: 'inactive', pairingError: reasonStr });
      syncMemory({ isReady: false });
    } catch (error) {
      console.error(`[Client ${deviceId}] Error handling disconnection:`, error.message);
    }
  });

  client.on('error', (error) => {
    console.error(`[Client ${deviceId}] Unhandled error:`, error.message);
  });

  clientsMap.set(deviceId, clientData);

  if (!client.isInitialized) {
    await client.initialize();
  }

  if (clientDoc.status === 'active') {
    scheduleOperationalReady();
    if (!clientDoc.phoneNumber) {
      schedulePhoneCapture();
    }
  }

  return clientData;
}

async function initializeClientForDevice(deviceId) {
  if (clientsMap.has(deviceId)) {
    return clientsMap.get(deviceId);
  }

  if (initLocks.has(deviceId)) {
    return initLocks.get(deviceId);
  }

  const initPromise = createClientInstance(deviceId);
  initLocks.set(deviceId, initPromise);

  try {
    return await initPromise;
  } finally {
    initLocks.delete(deviceId);
  }
}

async function provisionClient() {
  await migrateExistingClients();

  const deviceId = crypto.randomUUID();
  // #region agent log
  debugLog('clientManager.js:provisionClient', 'provision started', {
    deviceId,
    clientsMapSize: clientsMap.size,
    activeDeviceIds: [...clientsMap.keys()]
  }, 'H1');
  // #endregion
  const clientDoc = new ClientModel({
    deviceId,
    status: 'initializing',
    needsName: false
  });
  await clientDoc.save();

  return initializeClientForDevice(deviceId);
}

async function getClient(identifier) {
  await migrateExistingClients();

  const clientDoc = await findClientDoc(identifier);
  if (!clientDoc) {
    throw new Error('Client not found');
  }

  const { deviceId } = clientDoc;

  if (clientsMap.has(deviceId)) {
    const clientData = clientsMap.get(deviceId);
    return {
      client: clientData.client,
      isReady: clientData.isReady,
      qrCode: clientData.qrCode,
      deviceId,
      phoneNumber: clientData.phoneNumber || clientDoc.phoneNumber
    };
  }

  return initializeClientForDevice(deviceId);
}

async function initializeClient(phoneNumber, name) {
  await migrateExistingClients();

  const normalizedPhone = normalizePhone(phoneNumber);

  let clientDoc = await ClientModel.findOne({ phoneNumber: normalizedPhone });
  if (!clientDoc) {
    clientDoc = new ClientModel({
      deviceId: crypto.randomUUID(),
      phoneNumber: normalizedPhone,
      status: 'initializing',
      needsName: false,
      name: name?.trim() || undefined
    });
    await clientDoc.save();
  } else if (name) {
    clientDoc.name = name.trim();
    await clientDoc.save();
  }

  return initializeClientForDevice(clientDoc.deviceId);
}

async function getAllClients() {
  await migrateExistingClients();

  const dbClients = await ClientModel.find({}).sort({ createdAt: -1 });
  return dbClients.map((clientDoc) => {
    const inMemoryData = clientsMap.get(clientDoc.deviceId);
    return buildStatusResponse(clientDoc, inMemoryData);
  });
}

async function getClientStatus(identifier) {
  await migrateExistingClients();

  const clientDoc = await findClientDoc(identifier);
  if (!clientDoc) {
    return null;
  }

  const inMemoryData = clientsMap.get(clientDoc.deviceId);
  const status = buildStatusResponse(clientDoc, inMemoryData);
  // #region agent log
  debugLog('clientManager.js:getClientStatus', 'status polled', {
    deviceId: clientDoc.deviceId,
    isReady: status.isReady,
    status: status.status,
    needsName: status.needsName,
    pairingError: status.pairingError,
    hasPhone: !!status.phoneNumber,
    memoryReady: !!inMemoryData?.isReady
  }, 'H4');
  // #endregion
  return status;
}

async function updateClientName(deviceId, name) {
  const trimmedName = name?.trim();
  if (!trimmedName) {
    throw new Error('name is required');
  }

  const clientDoc = await ClientModel.findOneAndUpdate(
    { deviceId },
    { name: trimmedName, needsName: false, pairingError: null, updatedAt: new Date() },
    { new: true }
  );

  if (!clientDoc) {
    throw new Error('Client not found');
  }

  const inMemoryData = clientsMap.get(deviceId);
  return buildStatusResponse(clientDoc, inMemoryData);
}

async function removeClient(identifier) {
  await migrateExistingClients();

  const clientDoc = await findClientDoc(identifier);
  if (!clientDoc) {
    return false;
  }

  const { deviceId } = clientDoc;
  // #region agent log
  debugLog('clientManager.js:removeClient', 'removeClient called', {
    deviceId,
    identifier: String(identifier),
    clientsMapSize: clientsMap.size
  }, 'H3');
  // #endregion

  const clientData = clientsMap.get(deviceId);

  if (clientData) {
    try {
      if (clientData.client?.isInitialized) {
        try {
          await clientData.client.destroy();
        } catch (destroyError) {
          console.error(`[Client ${deviceId}] Error destroying client:`, destroyError.message);
        }
      }

      if (clientData.client) {
        try {
          await clientData.client.logout();
        } catch (logoutError) {
          console.warn(`[Client ${deviceId}] Warning during logout:`, logoutError.message);
        }
      }
    } catch (error) {
      console.error(`[Client ${deviceId}] Error in removeClient cleanup:`, error.message);
    }

    clientsMap.delete(deviceId);
  }

  initLocks.delete(deviceId);

  const cachePath = path.join(process.cwd(), 'wwebjs_cache', deviceId);
  if (fs.existsSync(cachePath)) {
    try {
      fs.rmSync(cachePath, { recursive: true, force: true });
    } catch (error) {
      console.warn(`[Client ${deviceId}] Could not remove cache directory:`, error.message);
    }
  }

  await ClientModel.findOneAndDelete({ deviceId });
  return true;
}

async function isClientReady(identifier) {
  const clientDoc = await findClientDoc(identifier);
  if (!clientDoc) return false;

  const inMemoryData = clientsMap.get(clientDoc.deviceId);
  if (!inMemoryData?.client) {
    return false;
  }

  if (inMemoryData.isReady) {
    // #region agent log
    debugLog('clientManager.js:isClientReady', 'isClientReady evaluated', {
      identifier: String(identifier),
      deviceId: clientDoc.deviceId,
      memoryReady: true,
      hasPupPage: !!inMemoryData.client?.pupPage,
      dbStatus: clientDoc.status,
      needsName: clientDoc.needsName,
      hasPhone: !!clientDoc.phoneNumber,
      ready: true,
      probeUsed: false
    }, 'H6');
    // #endregion
    return true;
  }

  const operational = await probeOperationalReady(inMemoryData.client);
  if (operational) {
    inMemoryData.isReady = true;
    clientsMap.set(clientDoc.deviceId, inMemoryData);
  }

  // #region agent log
  debugLog('clientManager.js:isClientReady', 'isClientReady evaluated', {
    identifier: String(identifier),
    deviceId: clientDoc.deviceId,
    memoryReady: !!inMemoryData.isReady,
    hasPupPage: !!inMemoryData.client?.pupPage,
    dbStatus: clientDoc.status,
    needsName: clientDoc.needsName,
    hasPhone: !!clientDoc.phoneNumber,
    ready: operational,
    probeUsed: true
  }, 'H6');
  // #endregion
  return operational;
}

async function resolveDeviceId(identifier) {
  const clientDoc = await findClientDoc(identifier);
  return clientDoc?.deviceId || null;
}

module.exports = {
  getClient,
  getAllClients,
  initializeClient,
  provisionClient,
  removeClient,
  getClientStatus,
  updateClientName,
  isClientReady,
  clearOperationalReady,
  findClientDoc,
  resolveDeviceId,
  migrateExistingClients
};

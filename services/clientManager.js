const { EventEmitter } = require('events');
const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const chromium = require('chromium');
const QRCode = require('qrcode');
const ClientModel = require('../models/Client');
const { debugLog } = require('../utils/debugLog');

const CACHE_DIR = path.join(process.cwd(), 'wwebjs_cache');
const LEGACY_DEVICE_ID = 'whatsapp-agent';

const clientsMap = new Map();
const deviceEvents = new EventEmitter();
deviceEvents.setMaxListeners(100);

function emitDeviceEvent(type, deviceId, payload = {}) {
  const event = { type, deviceId, payload, timestamp: Date.now() };
  deviceEvents.emit('device_event', event);
  return event;
}

function createWhatsAppClient(deviceId) {
  return new Client({
    authStrategy: new LocalAuth({
      clientId: deviceId,
      dataPath: CACHE_DIR,
    }),
    takeoverOnConflict: true,
    takeoverTimeoutMs: 10000,
    puppeteer: {
      executablePath: process.env.CHROMIUM_PATH || chromium.path,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      headless: true,
    },
  });
}

function isRuntimeReady(runtime) {
  return !!(runtime?.isReady && runtime?.client?.pupPage);
}

function attachClientHandlers(runtime) {
  const { client, deviceId } = runtime;

  client.on('qr', async (qr) => {
    runtime.qrCode = qr;
    try {
      runtime.qrCodeImage = await QRCode.toDataURL(qr);
    } catch {
      runtime.qrCodeImage = null;
    }
    runtime.status = 'initializing';
    runtime.isReady = false;
    await ClientModel.updateOne({ deviceId }, { status: 'initializing', pairingError: null });
    // #region agent log
    debugLog('clientManager.js:qr', 'qr event fired', { deviceId, hasImage: !!runtime.qrCodeImage }, 'H-BE-QR');
    // #endregion
    emitDeviceEvent('qr', deviceId, {
      qrCode: qr,
      qrCodeImage: runtime.qrCodeImage,
    });
  });

  client.on('authenticated', () => {
    runtime.isAuthenticated = true;
    emitDeviceEvent('authenticated', deviceId);
  });

  client.on('auth_failure', async (msg) => {
    const message = String(msg);
    runtime.pairingError = message;
    runtime.status = 'inactive';
    runtime.isReady = false;
    runtime.isAuthenticated = false;
    await ClientModel.updateOne(
      { deviceId },
      { status: 'inactive', pairingError: message }
    );
    emitDeviceEvent('auth_failure', deviceId, { message });
  });

  client.on('disconnected', async (reason) => {
    runtime.isReady = false;
    runtime.isAuthenticated = false;
    runtime.status = 'inactive';
    runtime.initPromise = null;
    await ClientModel.updateOne({ deviceId }, { status: 'inactive' });
    emitDeviceEvent('disconnected', deviceId, { reason: String(reason) });
  });

  client.on('ready', async () => {
    const phoneNumber = client.info?.wid?.user;

    const duplicate = phoneNumber
      ? await ClientModel.findOne({ phoneNumber, deviceId: { $ne: deviceId } })
      : null;

    if (duplicate) {
      runtime.pairingError = 'This WhatsApp account is already linked to another device';
      runtime.status = 'inactive';
      runtime.isReady = false;
      await ClientModel.updateOne(
        { deviceId },
        {
          status: 'inactive',
          pairingError: runtime.pairingError,
        }
      );
      emitDeviceEvent('auth_failure', deviceId, { message: runtime.pairingError });
      try {
        await client.destroy();
      } catch {
        /* ignore */
      }
      clientsMap.delete(deviceId);
      return;
    }

    runtime.isReady = true;
    runtime.phoneNumber = phoneNumber;
    runtime.qrCode = null;
    runtime.qrCodeImage = null;
    runtime.status = 'active';
    runtime.needsName = true;
    runtime.pairingError = null;

    await ClientModel.updateOne(
      { deviceId },
      {
        phoneNumber,
        status: 'active',
        needsName: true,
        lastConnected: new Date(),
        pairingError: null,
      }
    );

    emitDeviceEvent('ready', deviceId, {
      phoneNumber,
      needsName: true,
      isReady: true,
      status: 'active',
    });
  });
}

async function startClient(deviceId, dbRecord = null) {
  if (clientsMap.has(deviceId)) {
    return clientsMap.get(deviceId);
  }

  const client = createWhatsAppClient(deviceId);
  const runtime = {
    deviceId,
    client,
    isReady: false,
    isAuthenticated: false,
    qrCode: null,
    qrCodeImage: null,
    status: 'initializing',
    phoneNumber: dbRecord?.phoneNumber || null,
    pairingError: dbRecord?.pairingError || null,
    needsName: dbRecord?.needsName || false,
    initPromise: null,
  };

  attachClientHandlers(runtime);
  clientsMap.set(deviceId, runtime);

  // #region agent log
  debugLog('clientManager.js:startClient', 'initialize starting', { deviceId }, 'H-BE-INIT');
  // #endregion
  runtime.initPromise = client.initialize().catch(async (err) => {
    runtime.initPromise = null;
    runtime.pairingError = err.message;
    runtime.status = 'inactive';
    // #region agent log
    debugLog('clientManager.js:initError', 'initialize failed', { deviceId, error: err.message }, 'H-BE-INIT');
    // #endregion
    await ClientModel.updateOne(
      { deviceId },
      { status: 'inactive', pairingError: err.message }
    );
    emitDeviceEvent('auth_failure', deviceId, { message: err.message });
  });

  return runtime;
}

function isAbandonedRecord(record) {
  const hasPhone = !!record.phoneNumber;
  const hasName = !!record.name?.trim();
  return (
    !hasPhone &&
    !hasName &&
    (record.status === 'initializing' || record.status === 'inactive')
  );
}

async function cleanupAbandonedClients() {
  const records = await ClientModel.find({
    status: { $in: ['initializing', 'inactive'] },
  });

  let removed = 0;
  for (const record of records) {
    if (!isAbandonedRecord(record)) {
      continue;
    }
    await removeClient(record.deviceId, true);
    removed += 1;
  }

  if (removed > 0) {
    console.log(`[ClientManager] Removed ${removed} abandoned device record(s)`);
  }
}

async function backfillClients() {
  const legacySessionDir = path.join(CACHE_DIR, `session-${LEGACY_DEVICE_ID}`);
  const legacyExists = fs.existsSync(legacySessionDir);
  const existingLegacy = await ClientModel.findOne({ deviceId: LEGACY_DEVICE_ID });

  if (legacyExists && !existingLegacy) {
    await ClientModel.create({
      deviceId: LEGACY_DEVICE_ID,
      status: 'initializing',
      name: 'Default Device',
    });
  }

  const records = await ClientModel.find({});
  for (const record of records) {
    if (!record.deviceId && record.phoneNumber) {
      record.deviceId = record.phoneNumber;
      await record.save();
    }
  }
}

async function initializeAllClients() {
  await backfillClients();
  await cleanupAbandonedClients();

  const records = await ClientModel.find({});
  for (const record of records) {
    if (isAbandonedRecord(record)) {
      continue;
    }
    await startClient(record.deviceId, record);
  }
}

async function destroyAllClients() {
  const deviceIds = [...clientsMap.keys()];
  for (const deviceId of deviceIds) {
    await removeClient(deviceId, false);
  }
}

function getRuntime(identifier) {
  if (!identifier) return null;

  if (clientsMap.has(identifier)) {
    return clientsMap.get(identifier);
  }

  for (const runtime of clientsMap.values()) {
    if (runtime.phoneNumber === identifier) {
      return runtime;
    }
  }

  return null;
}

function getDefaultReadyRuntime() {
  const preferredId = process.env.DEFAULT_CLIENT_ID || LEGACY_DEVICE_ID;
  const preferred = getRuntime(preferredId);
  if (preferred && isRuntimeReady(preferred)) {
    return preferred;
  }

  for (const runtime of clientsMap.values()) {
    if (isRuntimeReady(runtime)) {
      return runtime;
    }
  }

  return null;
}

function getClient(identifier) {
  return getRuntime(identifier)?.client ?? null;
}

function isClientReady(identifier) {
  const runtime = getRuntime(identifier);
  return isRuntimeReady(runtime);
}

async function toClientDto(deviceId) {
  const runtime = clientsMap.get(deviceId);
  const dbRecord = await ClientModel.findOne({ deviceId });
  if (!dbRecord && !runtime) return null;

  return {
    deviceId,
    name: dbRecord?.name,
    phoneNumber: runtime?.phoneNumber || dbRecord?.phoneNumber,
    status: runtime?.status || dbRecord?.status || 'initializing',
    isReady: isRuntimeReady(runtime),
    needsName: dbRecord?.needsName ?? runtime?.needsName ?? false,
    pairingError: runtime?.pairingError || dbRecord?.pairingError || null,
    lastConnected: dbRecord?.lastConnected,
    hasQrCode: !!(runtime?.qrCodeImage || runtime?.qrCode),
    createdAt: dbRecord?.createdAt,
    updatedAt: dbRecord?.updatedAt,
  };
}

async function listAllClients() {
  const records = await ClientModel.find({}).sort({ createdAt: -1 });
  const clients = [];
  for (const record of records) {
    const dto = await toClientDto(record.deviceId);
    if (dto) clients.push(dto);
  }
  return clients;
}

async function ensureQrImage(runtime) {
  if (!runtime.qrCode) {
    return false;
  }
  if (!runtime.qrCodeImage) {
    try {
      runtime.qrCodeImage = await QRCode.toDataURL(runtime.qrCode);
    } catch {
      runtime.qrCodeImage = null;
      return false;
    }
  }
  return !!runtime.qrCodeImage;
}

async function waitForQr(runtime, maxMs = 120000) {
  if (await ensureQrImage(runtime)) {
    return true;
  }

  return new Promise((resolve) => {
    const deadline = Date.now() + maxMs;
    let timer;

    const finish = async () => {
      clearTimeout(timer);
      runtime.client.removeListener('qr', onQr);
      resolve(await ensureQrImage(runtime));
    };

    const onQr = () => {
      void finish();
    };

    const poll = () => {
      void (async () => {
        if (await ensureQrImage(runtime)) {
          await finish();
          return;
        }
        if (Date.now() >= deadline) {
          await finish();
          return;
        }
        timer = setTimeout(poll, 250);
      })();
    };

    runtime.client.once('qr', onQr);
    poll();
  });
}

async function cleanupInFlightProvisioning() {
  await cleanupAbandonedClients();

  for (const deviceId of [...clientsMap.keys()]) {
    const runtime = clientsMap.get(deviceId);
    if (!runtime?.isReady && !runtime?.phoneNumber) {
      await removeClient(deviceId, true);
    }
  }
}

async function provisionClient() {
  await cleanupInFlightProvisioning();
  const deviceId = crypto.randomUUID();
  const dbRecord = await ClientModel.create({
    deviceId,
    status: 'initializing',
    needsName: false,
  });
  const runtime = await startClient(deviceId, dbRecord);
  return { deviceId, runtime, dbRecord };
}

async function registerClient(phoneNumber, name) {
  const existing = await ClientModel.findOne({ phoneNumber });
  if (existing) {
    const err = new Error('A client with this phone number already exists');
    err.statusCode = 409;
    throw err;
  }

  const deviceId = phoneNumber;
  const dbRecord = await ClientModel.create({
    deviceId,
    phoneNumber,
    name,
    status: 'initializing',
    needsName: !name,
  });
  await startClient(deviceId, dbRecord);
  return dbRecord;
}

async function updateClientName(deviceId, name) {
  const dbRecord = await ClientModel.findOne({ deviceId });
  if (!dbRecord) {
    const err = new Error('Client not found');
    err.statusCode = 404;
    throw err;
  }

  dbRecord.name = name;
  dbRecord.needsName = false;
  await dbRecord.save();

  const runtime = clientsMap.get(deviceId);
  if (runtime) runtime.needsName = false;

  emitDeviceEvent('name_updated', deviceId, { name });
  return dbRecord;
}

async function getClientQr(deviceId) {
  const runtime = clientsMap.get(deviceId);
  if (!runtime) {
    const err = new Error('Client not found');
    err.statusCode = 404;
    throw err;
  }

  if (!runtime.qrCode) {
    return { qrCode: null, qrCodeImage: null };
  }

  if (!runtime.qrCodeImage) {
    runtime.qrCodeImage = await QRCode.toDataURL(runtime.qrCode);
  }

  return {
    qrCode: runtime.qrCode,
    qrCodeImage: runtime.qrCodeImage,
  };
}

function deleteCacheDir(deviceId) {
  const sessionDir = path.join(CACHE_DIR, `session-${deviceId}`);
  if (fs.existsSync(sessionDir)) {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
}

async function removeClient(deviceId, deleteDb = true) {
  const runtime = clientsMap.get(deviceId);

  if (runtime) {
    try {
      await runtime.client.destroy();
    } catch {
      /* ignore */
    }
    clientsMap.delete(deviceId);
  }

  deleteCacheDir(deviceId);

  if (deleteDb) {
    await ClientModel.deleteOne({ deviceId });
    emitDeviceEvent('removed', deviceId);
  }
}

async function getConnectionStatus() {
  const clients = await listAllClients();
  const readyCount = clients.filter((c) => c.isReady).length;
  return {
    connected: readyCount > 0,
    readyCount,
    totalCount: clients.length,
    clients,
  };
}

module.exports = {
  deviceEvents,
  initializeAllClients,
  destroyAllClients,
  getClient,
  getRuntime,
  getDefaultReadyRuntime,
  isClientReady,
  isRuntimeReady,
  listAllClients,
  provisionClient,
  registerClient,
  updateClientName,
  getClientQr,
  removeClient,
  toClientDto,
  getConnectionStatus,
  emitDeviceEvent,
  cleanupAbandonedClients,
  waitForQr,
};

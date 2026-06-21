const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { deviceEvents } = require('./clientManager');
const { debugLog } = require('../utils/debugLog');

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

function initializeDeviceSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws/devices' });
  // #region agent log
  debugLog('deviceSocket.js:init', 'WebSocket server initialized', { path: '/ws/devices' }, 'H5');
  // #endregion

  wss.on('connection', (socket) => {
    // #region agent log
    debugLog('deviceSocket.js:connection', 'client connected', {}, 'H5');
    // #endregion
    let authenticated = false;

    const heartbeat = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        socket.ping();
      }
    }, 30000);

    const onDeviceEvent = (event) => {
      if (socket.readyState === socket.OPEN && authenticated) {
        socket.send(
          JSON.stringify({
            type: 'device_event',
            eventType: event.type,
            deviceId: event.deviceId,
            payload: event.payload,
            timestamp: event.timestamp,
          })
        );
      }
    };

    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        socket.close(4401, 'Authentication timeout');
      }
    }, 10000);

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'auth') {
          if (!message.token) {
            socket.close(4401, 'No token provided');
            return;
          }

          jwt.verify(message.token, JWT_SECRET, (err) => {
            if (err) {
              // #region agent log
              debugLog('deviceSocket.js:auth', 'auth rejected', { reason: err.message }, 'H3');
              // #endregion
              socket.close(4401, 'Invalid token');
              return;
            }

            authenticated = true;
            clearTimeout(authTimeout);
            deviceEvents.on('device_event', onDeviceEvent);
            socket.send(JSON.stringify({ type: 'auth_ok' }));
            // #region agent log
            debugLog('deviceSocket.js:auth', 'auth ok', {}, 'H3');
            // #endregion
          });
        }
      } catch {
        socket.close(4400, 'Invalid message');
      }
    });

    socket.on('close', (code, reason) => {
      // #region agent log
      debugLog('deviceSocket.js:close', 'client disconnected', {
        code,
        reason: reason?.toString(),
        authenticated,
      }, 'H3');
      // #endregion
      clearInterval(heartbeat);
      clearTimeout(authTimeout);
      deviceEvents.off('device_event', onDeviceEvent);
    });

    socket.on('error', () => {
      clearInterval(heartbeat);
      clearTimeout(authTimeout);
      deviceEvents.off('device_event', onDeviceEvent);
    });
  });

  return wss;
}

module.exports = { initializeDeviceSocket };

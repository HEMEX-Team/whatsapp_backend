require('dotenv').config();
const jwt = require('jsonwebtoken');
const http = require('http');

const secret = process.env.JWT_SECRET || 'your_jwt_secret';
const token = jwt.sign({ userId: 'test', username: 'test' }, secret, { expiresIn: '1h' });

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: 3000,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => {
          buf += c;
        });
        res.on('end', () => resolve(JSON.parse(buf || '{}')));
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const prov = await request('POST', '/clients/provision', {});
  console.log('provision deviceId=', prov.deviceId, 'hasImage=', !!prov.qrCodeImage);
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    const qr = await request('GET', `/clients/${prov.deviceId}/qr`);
    console.log('poll', i, 'hasImage=', !!qr.qrCodeImage);
    if (qr.qrCodeImage) {
      console.log('SUCCESS');
      process.exit(0);
    }
  }
  console.log('TIMEOUT no qr');
  process.exit(1);
})();

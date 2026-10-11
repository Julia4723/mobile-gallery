// ОДНОРАЗОВЫЙ КОД ЭКСПЕРИМЕНТА. В продукт не переносится.
// Сервер-заглушка для проверки пути «телефон → компьютер → плагин Figma».
// Запуск: node spike/server.mjs   (PORT и SPIKE_TOKEN можно задать через окружение)

import http from 'node:http';
import os from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 8787);
const TOKEN = process.env.SPIKE_TOKEN ?? randomBytes(16).toString('hex');
const MAX_BYTES = 20 * 1024 * 1024;

let last = null; // { bytes: Buffer, detected: string }

// У iframe плагина Figma origin равен null, поэтому нужен Allow-Origin: *.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

function send(res, status, body, headers = {}) {
  const isJson = !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    ...CORS,
    'Content-Type': isJson ? 'application/json' : 'application/octet-stream',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function authorized(req) {
  const given = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${TOKEN}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function detect(b) {
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp') {
    const brand = b.toString('latin1', 8, 12);
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
    if (brand === 'avif') return 'image/avif';
  }
  return 'unknown';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error('too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  console.log(`${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${path}`);

  if (req.method === 'OPTIONS') return send(res, 204, Buffer.alloc(0));

  // Открыт без токена: нужен для проверки из браузера телефона.
  if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true });

  if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });

  if (req.method === 'GET' && path === '/auth-check') return send(res, 200, { ok: true, auth: true });

  if (req.method === 'POST' && path === '/upload') {
    let bytes;
    try {
      bytes = await readBody(req);
    } catch {
      // Сначала отдаём ответ, потом рвём соединение, иначе клиент не увидит 413.
      res.on('finish', () => req.destroy());
      return send(res, 413, { error: 'too large' }, { Connection: 'close' });
    }
    const detected = detect(bytes);
    console.log(`  upload: ${bytes.length} байт, заявлен "${req.headers['content-type'] ?? ''}", определён ${detected}, начало ${bytes.subarray(0, 16).toString('hex')}`);
    if (detected === 'unknown') return send(res, 415, { error: 'not an image' });
    last = { bytes, detected };
    return send(res, 200, { ok: true, bytes: bytes.length, detected, declared: req.headers['content-type'] ?? null });
  }

  if (req.method === 'GET' && path === '/last') {
    if (!last) return send(res, 404, { error: 'nothing uploaded yet' });
    return send(res, 200, last.bytes, { 'Content-Type': last.detected });
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`Сервер-заглушка слушает порт ${PORT}`);
  console.log(`  с этого компьютера: http://localhost:${PORT}/health`);
  for (const ip of ips) console.log(`  с телефона:         http://${ip}:${PORT}/health`);
  console.log(`  токен: ${TOKEN}`);
});

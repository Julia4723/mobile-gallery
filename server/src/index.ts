// Точка входа: npm start

import os from 'node:os';
import path from 'node:path';
import { buildApp } from './app.ts';
import { PORT, SWEEP_INTERVAL_MS } from './config.ts';
import { listAddresses, resolveLanAddress } from './network.ts';
import { JobQueue } from './queue.ts';
import { startServers } from './server.ts';
import { createStorage } from './storage.ts';
import { loadOrCreateToken } from './token.ts';

const tokenFile = path.resolve('.token');
const interfaceName = (process.env.LAN_INTERFACE ?? '').trim();

function printInterfaces() {
  const available = listAddresses();
  if (available.length === 0) console.log('  (сетевых интерфейсов с IPv4-адресом не найдено)');
  for (const item of available) console.log(`  ${item.name}  ${item.address}`);
}

let lanAddress: string | null = null;
if (interfaceName) {
  lanAddress = resolveLanAddress(interfaceName);
  if (!lanAddress) {
    console.error(`У интерфейса «${interfaceName}» из LAN_INTERFACE нет IPv4-адреса. Доступные интерфейсы:`);
    printInterfaces();
    process.exit(1);
  }
}

const token = await loadOrCreateToken(tokenFile);
const storage = createStorage(path.join(os.tmpdir(), 'mobile-gallery-uploads'));
await storage.init();

const queue = new JobQueue(Date.now, (id) => {
  storage.remove(id).catch((error) => console.error(`Не удалось удалить файл задания ${id}:`, error));
});
setInterval(() => queue.sweep(), SWEEP_INTERVAL_MS).unref();

try {
  await startServers({ port: PORT, lanAddress, createApp: () => buildApp({ queue, storage, token }) });
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') console.error(`Порт ${PORT} уже занят. Остановите другую программу на этом порту.`);
  else console.error('Сервер не запустился:', error);
  process.exit(1);
}

console.log('Сервер Mobile Gallery запущен.');
console.log(`  Для плагина Figma:  http://localhost:${PORT}`);
if (lanAddress) {
  console.log(`  Для телефона:       http://${lanAddress}:${PORT}   (интерфейс ${interfaceName})`);
} else {
  console.log('  Для телефона:       недоступен. Укажите интерфейс Wi-Fi в server/.env, например LAN_INTERFACE=en0.');
  console.log('  Интерфейсы этого компьютера:');
  printInterfaces();
}
console.log(`  Токен лежит в файле: ${tokenFile}`);

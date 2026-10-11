import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { listAddresses, resolveLanAddress } from '../src/network.ts';
import { startServers } from '../src/server.ts';
import { isAuthorized, loadOrCreateToken } from '../src/token.ts';

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1000 });
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
  });
}

const createApp = () => {
  const app = Fastify();
  app.get('/ping', async () => 'pong');
  return app;
};

test('токен создаётся при первом запуске и сохраняется', async () => {
  const file = path.join(await mkdtemp(path.join(os.tmpdir(), 'mobile-gallery-test-')), '.token');
  const first = await loadOrCreateToken(file);
  assert.match(first, /^[0-9a-f]{32}$/);
  assert.equal((await readFile(file, 'utf8')).trim(), first);
  assert.equal((await stat(file)).mode & 0o077, 0);
  assert.equal(await loadOrCreateToken(file), first);
});

test('токен принимается только в виде Bearer из заголовка', () => {
  assert.equal(isAuthorized('Bearer abc', 'abc'), true);
  assert.equal(isAuthorized('Bearer abd', 'abc'), false);
  assert.equal(isAuthorized('abc', 'abc'), false);
  assert.equal(isAuthorized(undefined, 'abc'), false);
});

test('адрес интерфейса определяется по имени', () => {
  const interfaces = {
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    en0: [
      { address: 'fe80::1', family: 'IPv6', internal: false },
      { address: '192.168.1.10', family: 'IPv4', internal: false },
    ],
    utun4: [{ address: '10.0.0.1', family: 'IPv4', internal: false }],
  } as unknown as NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  assert.equal(resolveLanAddress('en0', interfaces), '192.168.1.10');
  assert.equal(resolveLanAddress('en9', interfaces), null);
  assert.equal(resolveLanAddress('lo0', interfaces), null);
  assert.deepEqual(listAddresses(interfaces), [
    { name: 'en0', address: '192.168.1.10' },
    { name: 'utun4', address: '10.0.0.1' },
  ]);
});

test('без интерфейса сервер слушает только 127.0.0.1', async (t) => {
  const port = await freePort();
  const running = await startServers({ port, lanAddress: null, createApp });
  t.after(() => running.close());
  assert.deepEqual(running.addresses, ['127.0.0.1']);
  assert.equal(await canConnect('127.0.0.1', port), true);
  for (const { address } of listAddresses()) {
    assert.equal(await canConnect(address, port), false, `порт открыт на ${address}`);
  }
});

test('с интерфейсом сервер слушает 127.0.0.1 и его адрес, остальные закрыты', async (t) => {
  const external = listAddresses();
  if (external.length === 0) return t.skip('на этом компьютере нет внешних интерфейсов');
  const [lan, ...others] = external;
  const port = await freePort();
  const running = await startServers({ port, lanAddress: lan.address, createApp });
  t.after(() => running.close());
  assert.deepEqual(running.addresses, ['127.0.0.1', lan.address]);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/ping`)).text(), 'pong');
  assert.equal(await (await fetch(`http://${lan.address}:${port}/ping`)).text(), 'pong');
  for (const { address } of others) {
    assert.equal(await canConnect(address, port), false, `порт открыт на ${address}`);
  }
});

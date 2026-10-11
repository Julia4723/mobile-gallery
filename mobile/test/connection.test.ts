import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyHealth, connectionMessage, normalizeServerUrl } from '../src/connection.ts';

const health = (authorized: boolean, pluginConnected: boolean) => ({ service: 'mobile-gallery', ok: true, authorized, pluginConnected });

test('пять исходов проверки соединения из раздела 9.3', () => {
  assert.equal(classifyHealth({ kind: 'network' }), 'offline');
  assert.equal(classifyHealth({ kind: 'response', status: 200, body: '<html>router</html>' }), 'foreign');
  assert.equal(classifyHealth({ kind: 'response', status: 200, body: { service: 'other', ok: true } }), 'foreign');
  assert.equal(classifyHealth({ kind: 'response', status: 404, body: null }), 'foreign');
  assert.equal(classifyHealth({ kind: 'response', status: 200, body: health(false, true) }), 'bad_token');
  assert.equal(classifyHealth({ kind: 'response', status: 200, body: health(true, false) }), 'no_plugin');
  assert.equal(classifyHealth({ kind: 'response', status: 200, body: health(true, true) }), 'ready');
});

test('у каждого исхода свой текст', () => {
  const texts = (['offline', 'foreign', 'bad_token', 'no_plugin', 'ready'] as const).map((state) => connectionMessage(state));
  assert.equal(new Set(texts).size, 5);
  assert.match(connectionMessage('no_plugin'), /Плагин в Figma не запущен/);
  assert.match(connectionMessage('foreign'), /другое устройство/);
});

test('адрес сервера приводится к виду без пробелов и завершающей косой черты', () => {
  assert.equal(normalizeServerUrl('  http://192.168.1.10:8787/  '), 'http://192.168.1.10:8787');
  assert.equal(normalizeServerUrl('http://192.168.1.10:8787'), 'http://192.168.1.10:8787');
  assert.equal(normalizeServerUrl('192.168.1.10:8787'), 'http://192.168.1.10:8787');
  assert.equal(normalizeServerUrl(''), '');
});

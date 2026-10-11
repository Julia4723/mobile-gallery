import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWithinLimit, nodeSize } from '../src/sizing.ts';

test('узел: ширина 400 px, высота по пропорциям', () => {
  assert.deepEqual(nodeSize(800, 600), { width: 400, height: 300 });
  assert.deepEqual(nodeSize(1080, 2400), { width: 400, height: 889 });
  assert.deepEqual(nodeSize(4284, 5712), { width: 400, height: 533 });
});

test('узел: высота не меньше 1 px', () => {
  assert.deepEqual(nodeSize(16384, 1), { width: 400, height: 1 });
});

test('изображение в пределах 4096 px не меняется', () => {
  assert.deepEqual(fitWithinLimit(4096, 3000), { width: 4096, height: 3000, resized: false });
  assert.deepEqual(fitWithinLimit(800, 600), { width: 800, height: 600, resized: false });
});

test('изображение больше 4096 px уменьшается по большей стороне', () => {
  assert.deepEqual(fitWithinLimit(6000, 4500), { width: 4096, height: 3072, resized: true });
  assert.deepEqual(fitWithinLimit(4284, 5712), { width: 3072, height: 4096, resized: true });
});

test('уменьшение не даёт нулевую сторону', () => {
  assert.deepEqual(fitWithinLimit(16384, 1), { width: 4096, height: 1, resized: true });
});

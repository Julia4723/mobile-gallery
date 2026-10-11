import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectImage } from '../src/image.ts';
import { gif, heic, jpeg, png } from './fixtures.ts';

test('тип и размеры читаются из заголовка PNG, JPEG и GIF', () => {
  assert.deepEqual(inspectImage(png(800, 600)), { ok: true, mimeType: 'image/png', width: 800, height: 600 });
  assert.deepEqual(inspectImage(jpeg(4284, 5712)), { ok: true, mimeType: 'image/jpeg', width: 4284, height: 5712 });
  assert.deepEqual(inspectImage(gif(320, 240)), { ok: true, mimeType: 'image/gif', width: 320, height: 240 });
});

test('JPEG: сегменты перед заголовком кадра пропускаются, прогрессивный кадр распознаётся', () => {
  const file = jpeg(1080, 2400);
  const exif = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x08]), Buffer.from('Exif\0\0', 'latin1')]);
  const withExif = Buffer.concat([file.subarray(0, 2), exif, file.subarray(2)]);
  assert.deepEqual(inspectImage(withExif), { ok: true, mimeType: 'image/jpeg', width: 1080, height: 2400 });

  const progressive = Buffer.from(file);
  progressive[progressive.indexOf(Buffer.from([0xff, 0xc0])) + 1] = 0xc2;
  assert.deepEqual(inspectImage(progressive), { ok: true, mimeType: 'image/jpeg', width: 1080, height: 2400 });
});

test('не изображение, HEIC и пустой файл отклоняются как неподдерживаемый тип', () => {
  assert.deepEqual(inspectImage(Buffer.from('hello world, not an image')), { ok: false, code: 'unsupported_type' });
  assert.deepEqual(inspectImage(heic()), { ok: false, code: 'unsupported_type' });
  assert.deepEqual(inspectImage(Buffer.alloc(0)), { ok: false, code: 'unsupported_type' });
});

test('обрезанный заголовок: размеры не читаются', () => {
  assert.deepEqual(inspectImage(png(800, 600).subarray(0, 12)), { ok: false, code: 'invalid_dimensions' });
  assert.deepEqual(inspectImage(jpeg(800, 600).subarray(0, 22)), { ok: false, code: 'invalid_dimensions' });
});

test('границы размеров: сторона от 1 до 16 384 px, площадь до 50 Мп', () => {
  assert.equal(inspectImage(png(16384, 3000)).ok, true);
  assert.equal(inspectImage(png(8064, 6048)).ok, true);
  assert.deepEqual(inspectImage(png(16385, 10)), { ok: false, code: 'invalid_dimensions' });
  assert.deepEqual(inspectImage(png(8000, 7000)), { ok: false, code: 'invalid_dimensions' });
  assert.deepEqual(inspectImage(png(0, 100)), { ok: false, code: 'invalid_dimensions' });
});

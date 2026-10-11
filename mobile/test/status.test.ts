import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, fromStatusResponse, fromUploadResponse, mimeTypeOf, needsPolling, type ItemState } from '../src/status.ts';

const job = (status: string, error: unknown = null) => ({ id: 'x', status, error });

test('ответ на загрузку: принятое задание получает статус сервера', () => {
  assert.deepEqual(fromUploadResponse(201, job('queued')), { kind: 'job', status: 'queued', errorCode: null, errorMessage: '' });
  assert.deepEqual(fromUploadResponse(200, job('inserted')), { kind: 'job', status: 'inserted', errorCode: null, errorMessage: '' });
});

test('ответ на загрузку: отказ сервера превращается в ошибку отправки с кодом', () => {
  const error = (code: string) => ({ error: { code, message: 'текст' } });
  assert.deepEqual(fromUploadResponse(413, error('file_too_large')), { kind: 'uploadError', code: 'file_too_large' });
  assert.deepEqual(fromUploadResponse(415, error('unsupported_type')), { kind: 'uploadError', code: 'unsupported_type' });
  assert.deepEqual(fromUploadResponse(422, error('invalid_dimensions')), { kind: 'uploadError', code: 'invalid_dimensions' });
  assert.deepEqual(fromUploadResponse(401, error('unauthorized')), { kind: 'uploadError', code: 'unauthorized' });
  assert.deepEqual(fromUploadResponse(500, 'oops'), { kind: 'uploadError', code: 'server' });
  assert.deepEqual(fromUploadResponse(200, '<html>router</html>'), { kind: 'uploadError', code: 'server' });
});

test('ответ на запрос статуса: 404 означает перезапуск сервера', () => {
  assert.deepEqual(fromStatusResponse(404, { error: { code: 'job_not_found' } }), { kind: 'unknown' });
  assert.deepEqual(fromStatusResponse(200, job('leased')), { kind: 'job', status: 'leased', errorCode: null, errorMessage: '' });
  assert.deepEqual(fromStatusResponse(200, job('failed', { code: 'insert_failed', message: 'Image is too large' })), {
    kind: 'job',
    status: 'failed',
    errorCode: 'insert_failed',
    errorMessage: 'Image is too large',
  });
  assert.equal(fromStatusResponse(500, 'oops'), null);
  assert.equal(fromStatusResponse(401, {}), null);
});

test('опрос нужен только заданиям в очереди и в работе', () => {
  assert.equal(needsPolling({ kind: 'job', status: 'queued', errorCode: null, errorMessage: '' }), true);
  assert.equal(needsPolling({ kind: 'job', status: 'leased', errorCode: null, errorMessage: '' }), true);
  for (const status of ['inserted', 'failed', 'expired'] as const) {
    assert.equal(needsPolling({ kind: 'job', status, errorCode: null, errorMessage: '' }), false);
  }
  assert.equal(needsPolling({ kind: 'selected' }), false);
  assert.equal(needsPolling({ kind: 'uploading' }), false);
  assert.equal(needsPolling({ kind: 'unknown' }), false);
});

test('тексты и действия для каждого статуса из раздела 5.7', () => {
  const cases: Array<[ItemState, string, { retry: boolean; remove: boolean }]> = [
    [{ kind: 'selected' }, '', { retry: false, remove: true }],
    [{ kind: 'uploading' }, 'Отправка…', { retry: false, remove: false }],
    [{ kind: 'job', status: 'queued', errorCode: null, errorMessage: '' }, 'В очереди', { retry: false, remove: false }],
    [{ kind: 'job', status: 'leased', errorCode: null, errorMessage: '' }, 'Вставляется…', { retry: false, remove: false }],
    [{ kind: 'job', status: 'inserted', errorCode: null, errorMessage: '' }, 'Вставлено', { retry: false, remove: true }],
    [{ kind: 'job', status: 'failed', errorCode: 'decode_failed', errorMessage: 'x' }, 'Файл повреждён или не читается', { retry: false, remove: true }],
    [{ kind: 'job', status: 'failed', errorCode: 'insert_failed', errorMessage: 'Image is too large' }, 'Figma не приняла изображение: Image is too large', { retry: true, remove: true }],
    [{ kind: 'job', status: 'failed', errorCode: 'plugin_no_ack', errorMessage: 'x' }, 'Плагин не подтвердил вставку. Проверьте страницу в Figma. Повтор не создаст дубликат', { retry: true, remove: true }],
    [{ kind: 'job', status: 'expired', errorCode: null, errorMessage: '' }, 'Плагин не забрал изображение за 30 минут', { retry: true, remove: true }],
    [{ kind: 'unknown' }, 'Сервер был перезапущен. Повтор не создаст дубликат', { retry: true, remove: true }],
    [{ kind: 'uploadError', code: 'network' }, 'Нет связи с сервером', { retry: true, remove: true }],
    [{ kind: 'uploadError', code: 'unauthorized' }, 'Токен неверный', { retry: true, remove: true }],
    [{ kind: 'uploadError', code: 'file_too_large' }, 'Файл больше 20 МБ', { retry: false, remove: true }],
    [{ kind: 'uploadError', code: 'unsupported_type' }, 'Формат не поддерживается. Подходят PNG, JPEG, GIF', { retry: false, remove: true }],
    [{ kind: 'uploadError', code: 'invalid_dimensions' }, 'Изображение слишком большое', { retry: false, remove: true }],
    [{ kind: 'uploadError', code: 'read_failed' }, 'Не удалось прочитать файл на телефоне', { retry: true, remove: true }],
    [{ kind: 'uploadError', code: 'server' }, 'Сервер ответил ошибкой', { retry: true, remove: true }],
  ];
  for (const [state, label, actions] of cases) {
    const view = describe(state);
    assert.equal(view.label, label);
    assert.deepEqual({ retry: view.canRetry, remove: view.canRemove }, actions, label);
  }
});

test('тон статуса: успех, ошибка, ожидание', () => {
  assert.equal(describe({ kind: 'job', status: 'inserted', errorCode: null, errorMessage: '' }).tone, 'success');
  assert.equal(describe({ kind: 'job', status: 'expired', errorCode: null, errorMessage: '' }).tone, 'error');
  assert.equal(describe({ kind: 'unknown' }).tone, 'error');
  assert.equal(describe({ kind: 'uploading' }).tone, 'progress');
  assert.equal(describe({ kind: 'selected' }).tone, 'neutral');
});

test('тип файла: из данных picker, иначе по расширению', () => {
  assert.equal(mimeTypeOf('image/jpeg', 'file:///a/b.heic'), 'image/jpeg');
  assert.equal(mimeTypeOf(null, 'file:///a/IMG_1.PNG'), 'image/png');
  assert.equal(mimeTypeOf(undefined, 'file:///a/photo.jpeg'), 'image/jpeg');
  assert.equal(mimeTypeOf(null, 'file:///a/photo.jpg'), 'image/jpeg');
  assert.equal(mimeTypeOf(null, 'file:///a/anim.gif'), 'image/gif');
  assert.equal(mimeTypeOf(null, 'file:///a/unknown'), 'application/octet-stream');
});

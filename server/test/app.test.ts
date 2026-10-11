import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/app.ts';
import { MAX_FILE_BYTES } from '../src/config.ts';
import { JobQueue } from '../src/queue.ts';
import { createStorage } from '../src/storage.ts';
import { gif, heic, jpeg, png, JOB_A, JOB_B } from './fixtures.ts';

const TOKEN = 'test-token';
const AUTH = { authorization: `Bearer ${TOKEN}` };

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mobile-gallery-test-'));
  const storage = createStorage(directory);
  await storage.init();
  const clock = { now: 1_000_000 };
  const queue = new JobQueue(() => clock.now, (id) => void storage.remove(id));
  const app = buildApp({ queue, storage, token: TOKEN });
  const upload = (id: string, bytes: Buffer, type = 'image/png') =>
    app.inject({ method: 'POST', url: '/api/uploads', headers: { ...AUTH, 'content-type': type, 'x-job-id': id }, payload: bytes });
  return { app, storage, directory, upload, advance: (ms: number) => (clock.now += ms) };
}

test('без токена, с неверным токеном и с токеном в URL — 401', async () => {
  const { app } = await setup();
  for (const request of [
    { url: '/api/jobs/next' },
    { url: '/api/jobs/next', headers: { authorization: 'Bearer wrong' } },
    { url: `/api/jobs/next?token=${TOKEN}` },
    { url: `/api/jobs/${JOB_A}` },
  ]) {
    const response = await app.inject({ method: 'GET', ...request });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'unauthorized');
  }
  const post = await app.inject({ method: 'POST', url: '/api/uploads', headers: { 'content-type': 'image/png', 'x-job-id': JOB_A }, payload: png(8, 8) });
  assert.equal(post.statusCode, 401);
});

test('health отвечает без токена и сообщает, верен ли токен', async () => {
  const { app } = await setup();
  const anonymous = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(anonymous.statusCode, 200);
  assert.deepEqual(anonymous.json(), { service: 'mobile-gallery', ok: true, authorized: false, pluginConnected: false });

  const wrong = await app.inject({ method: 'GET', url: '/api/health', headers: { authorization: 'Bearer wrong' } });
  assert.equal(wrong.json().authorized, false);

  const authorized = await app.inject({ method: 'GET', url: '/api/health', headers: AUTH });
  assert.equal(authorized.json().authorized, true);
});

test('pluginConnected: true после запроса заданий, false через 10 секунд без запросов', async () => {
  const { app, advance } = await setup();
  await app.inject({ method: 'GET', url: '/api/jobs/next', headers: AUTH });
  assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).json().pluginConnected, true);
  advance(11_000);
  assert.equal((await app.inject({ method: 'GET', url: '/api/health' })).json().pluginConnected, false);
});

test('preflight с Origin: null получает заголовки CORS без токена', async () => {
  const { app } = await setup();
  const response = await app.inject({
    method: 'OPTIONS',
    url: '/api/jobs/next',
    headers: { origin: 'null', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
  });
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers['access-control-allow-origin'], '*');
  assert.match(String(response.headers['access-control-allow-headers']), /Authorization/);
  assert.match(String(response.headers['access-control-allow-headers']), /Content-Type/);

  const get = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(get.headers['access-control-allow-origin'], '*');
});

test('PNG, JPEG и GIF создают задание в очереди', async () => {
  const { upload } = await setup();
  const created = await upload(JOB_A, png(800, 600));
  assert.equal(created.statusCode, 201);
  const job = created.json();
  assert.equal(job.id, JOB_A);
  assert.equal(job.status, 'queued');
  assert.equal(job.attempts, 0);
  assert.deepEqual([job.mimeType, job.width, job.height, job.bytes], ['image/png', 800, 600, 33]);

  assert.equal((await upload(JOB_B, jpeg(4284, 5712), 'image/jpeg')).statusCode, 201);
  assert.equal((await upload('33333333-3333-4333-8333-333333333333', gif(10, 10), 'image/gif')).statusCode, 201);
});

test('отклонение файлов: размер, тип, подмена типа, размеры, идентификатор', async () => {
  const { upload, directory } = await setup();
  const tooLarge = Buffer.alloc(MAX_FILE_BYTES + 1);
  png(100, 100).copy(tooLarge);

  const cases: Array<[Promise<{ statusCode: number; json(): any }>, number, string]> = [
    [upload(JOB_A, tooLarge), 413, 'file_too_large'],
    [upload(JOB_A, Buffer.from('hello world, not an image')), 415, 'unsupported_type'],
    [upload(JOB_A, heic()), 415, 'unsupported_type'],
    [upload(JOB_A, heic(), 'image/heic'), 415, 'unsupported_type'],
    [upload(JOB_A, png(100, 100), 'image/jpeg'), 415, 'unsupported_type'],
    [upload(JOB_A, png(8000, 7000)), 422, 'invalid_dimensions'],
    [upload(JOB_A, png(16385, 10)), 422, 'invalid_dimensions'],
    [upload('not-a-uuid', png(100, 100)), 400, 'invalid_job_id'],
    [upload('../../etc/passwd', png(100, 100)), 400, 'invalid_job_id'],
  ];
  for (const [request, status, code] of cases) {
    const response = await request;
    assert.equal(response.statusCode, status, code);
    assert.equal(response.json().error.code, code);
  }
  assert.deepEqual(await readdir(directory), []);
});

test('файл ровно 20 МБ принимается', async () => {
  const { upload } = await setup();
  const exact = Buffer.alloc(MAX_FILE_BYTES);
  png(100, 100).copy(exact);
  assert.equal((await upload(JOB_A, exact)).statusCode, 201);
});

test('повторная загрузка с тем же идентификатором не создаёт второе задание', async () => {
  const { app, upload } = await setup();
  await upload(JOB_A, png(800, 600));
  const again = await upload(JOB_A, png(10, 10));
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().width, 800);

  const next = (await app.inject({ method: 'GET', url: '/api/jobs/next', headers: AUTH })).json();
  assert.equal(next.job.id, JOB_A);
  assert.equal(next.pending, 0);
  assert.equal((await upload(JOB_A, png(10, 10))).json().status, 'leased');
});

test('путь задания: выдача, файл, подтверждение, статус', async () => {
  const { app, upload, directory } = await setup();
  const original = png(800, 600);
  await upload(JOB_A, original);
  await upload(JOB_B, jpeg(100, 100), 'image/jpeg');

  const next = (await app.inject({ method: 'GET', url: '/api/jobs/next', headers: AUTH })).json();
  assert.equal(next.job.id, JOB_A);
  assert.equal(next.job.status, 'leased');
  assert.equal(next.job.attempts, 1);
  assert.equal(next.pending, 1);

  const file = await app.inject({ method: 'GET', url: `/api/jobs/${JOB_A}/file`, headers: AUTH });
  assert.equal(file.statusCode, 200);
  assert.equal(file.headers['content-type'], 'image/png');
  assert.deepEqual(file.rawPayload, original);

  const ack = await app.inject({ method: 'POST', url: `/api/jobs/${JOB_A}/ack`, headers: AUTH, payload: { result: 'inserted' } });
  assert.equal(ack.statusCode, 200);
  assert.equal(ack.json().status, 'inserted');
  const repeat = await app.inject({ method: 'POST', url: `/api/jobs/${JOB_A}/ack`, headers: AUTH, payload: { result: 'inserted' } });
  assert.equal(repeat.statusCode, 200);

  const status = await app.inject({ method: 'GET', url: `/api/jobs/${JOB_A}`, headers: AUTH });
  assert.equal(status.json().status, 'inserted');

  const gone = await app.inject({ method: 'GET', url: `/api/jobs/${JOB_A}/file`, headers: AUTH });
  assert.equal(gone.statusCode, 410);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(await readdir(directory), [JOB_B]);
});

test('ошибки подтверждения и неизвестные задания', async () => {
  const { app, upload } = await setup();
  await upload(JOB_A, png(800, 600));
  const ack = (payload: unknown, id = JOB_A) => app.inject({ method: 'POST', url: `/api/jobs/${id}/ack`, headers: AUTH, payload: payload as object });

  for (const body of [{}, { result: 'done' }, { result: 'failed' }, { result: 'failed', reason: 'plugin_no_ack' }]) {
    const response = await ack(body);
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error.code, 'invalid_ack');
  }
  assert.equal((await ack({ result: 'inserted' }, JOB_B)).statusCode, 404);

  const failed = await ack({ result: 'failed', reason: 'decode_failed', message: 'не читается' });
  assert.equal(failed.statusCode, 200);
  assert.deepEqual(failed.json().error, { code: 'decode_failed', message: 'не читается' });

  await ack({ result: 'inserted' });
  const conflict = await ack({ result: 'failed', reason: 'insert_failed' });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, 'job_finished');

  assert.equal((await app.inject({ method: 'GET', url: `/api/jobs/${JOB_B}`, headers: AUTH })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `/api/jobs/${JOB_B}/file`, headers: AUTH })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/unknown', headers: AUTH })).statusCode, 404);
});

test('повторная загрузка после ошибки возвращает задание в очередь', async () => {
  const { app, upload } = await setup();
  await upload(JOB_A, png(800, 600));
  await app.inject({ method: 'POST', url: `/api/jobs/${JOB_A}/ack`, headers: AUTH, payload: { result: 'failed', reason: 'insert_failed' } });
  const again = await upload(JOB_A, png(640, 480));
  assert.equal(again.statusCode, 201);
  assert.deepEqual([again.json().status, again.json().attempts, again.json().width], ['queued', 0, 640]);
});

test('при старте временная папка очищается', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mobile-gallery-test-'));
  await writeFile(path.join(directory, 'old-file'), 'x');
  await createStorage(directory).init();
  assert.deepEqual(await readdir(directory), []);
});

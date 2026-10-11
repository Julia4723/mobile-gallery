import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue } from '../src/queue.ts';
import { JOB_A, JOB_B, JOB_C } from './fixtures.ts';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const META = { mimeType: 'image/png', bytes: 100, width: 800, height: 600 } as const;

// Очередь с подменным временем. released — задания, файлы которых сервер должен удалить.
function setup() {
  const clock = { now: 1_000_000 };
  const released: string[] = [];
  const queue = new JobQueue(() => clock.now, (id) => released.push(id));
  const advance = (ms: number) => (clock.now += ms);
  return { queue, released, advance };
}

test('новое задание попадает в очередь с нулём попыток', () => {
  const { queue } = setup();
  const job = queue.submit(JOB_A, META);
  assert.equal(job.status, 'queued');
  assert.equal(job.attempts, 0);
  assert.equal(job.error, null);
  assert.equal(queue.pending(), 1);
});

test('задания выдаются в порядке создания, выдача увеличивает счётчик попыток', () => {
  const { queue, advance } = setup();
  queue.submit(JOB_A, META);
  advance(SECOND);
  queue.submit(JOB_B, META);
  advance(SECOND);
  queue.submit(JOB_C, META);

  const first = queue.leaseNext();
  assert.equal(first?.id, JOB_A);
  assert.equal(first?.status, 'leased');
  assert.equal(first?.attempts, 1);
  assert.equal(queue.pending(), 2);
  assert.equal(queue.leaseNext()?.id, JOB_B);
  assert.equal(queue.leaseNext()?.id, JOB_C);
  assert.equal(queue.leaseNext(), null);
});

test('арендованное задание повторно не выдаётся, пока аренда не истекла', () => {
  const { queue, advance } = setup();
  queue.submit(JOB_A, META);
  queue.leaseNext();
  advance(59 * SECOND);
  assert.equal(queue.leaseNext(), null);
  assert.equal(queue.get(JOB_A)?.status, 'leased');
});

test('через 60 секунд без ответа задание возвращается и выдаётся раньше более новых', () => {
  const { queue, advance } = setup();
  queue.submit(JOB_A, META);
  queue.leaseNext();
  advance(SECOND);
  queue.submit(JOB_B, META);
  advance(60 * SECOND);
  assert.equal(queue.get(JOB_A)?.status, 'queued');
  const again = queue.leaseNext();
  assert.equal(again?.id, JOB_A);
  assert.equal(again?.attempts, 2);
});

test('после третьей выдачи без ответа: failed с причиной plugin_no_ack, файл удаляется', () => {
  const { queue, released, advance } = setup();
  queue.submit(JOB_A, META);
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(queue.leaseNext()?.attempts, attempt);
    advance(60 * SECOND);
  }
  const job = queue.get(JOB_A);
  assert.equal(job?.status, 'failed');
  assert.equal(job?.error?.code, 'plugin_no_ack');
  assert.deepEqual(released, [JOB_A]);
  assert.equal(queue.leaseNext(), null);
});

test('задание, не забранное 30 минут, истекает, файл удаляется', () => {
  const { queue, released, advance } = setup();
  queue.submit(JOB_A, META);
  advance(30 * MINUTE - SECOND);
  assert.equal(queue.get(JOB_A)?.status, 'queued');
  advance(SECOND);
  assert.equal(queue.get(JOB_A)?.status, 'expired');
  assert.deepEqual(released, [JOB_A]);
});

test('отсчёт 30 минут во время аренды не останавливается', () => {
  const { queue, advance } = setup();
  queue.submit(JOB_A, META);
  advance(29 * MINUTE + 30 * SECOND);
  queue.leaseNext();
  advance(60 * SECOND);
  assert.equal(queue.get(JOB_A)?.status, 'expired');
});

test('запись удаляется через час после конечного состояния', () => {
  const { queue, advance } = setup();
  queue.submit(JOB_A, META);
  queue.leaseNext();
  queue.ack(JOB_A, { result: 'inserted' });
  advance(60 * MINUTE - SECOND);
  assert.equal(queue.get(JOB_A)?.status, 'inserted');
  advance(SECOND);
  assert.equal(queue.get(JOB_A), null);
});

test('подтверждение «вставлено» принимается из любого состояния и повторно', () => {
  const leased = setup();
  leased.queue.submit(JOB_A, META);
  leased.queue.leaseNext();
  assert.deepEqual(leased.queue.ack(JOB_A, { result: 'inserted' }).outcome, 'ok');
  assert.equal(leased.queue.get(JOB_A)?.status, 'inserted');
  assert.deepEqual(leased.released, [JOB_A]);
  assert.equal(leased.queue.ack(JOB_A, { result: 'inserted' }).outcome, 'ok');

  const queued = setup();
  queued.queue.submit(JOB_A, META);
  queued.queue.ack(JOB_A, { result: 'inserted' });
  assert.equal(queued.queue.get(JOB_A)?.status, 'inserted');
  assert.equal(queued.queue.pending(), 0);

  const expired = setup();
  expired.queue.submit(JOB_A, META);
  expired.advance(30 * MINUTE);
  assert.equal(expired.queue.get(JOB_A)?.status, 'expired');
  expired.queue.ack(JOB_A, { result: 'inserted' });
  assert.equal(expired.queue.get(JOB_A)?.status, 'inserted');
  assert.equal(expired.queue.get(JOB_A)?.error, null);

  const failed = setup();
  failed.queue.submit(JOB_A, META);
  failed.queue.ack(JOB_A, { result: 'failed', reason: 'insert_failed', message: 'x' });
  failed.queue.ack(JOB_A, { result: 'inserted' });
  assert.equal(failed.queue.get(JOB_A)?.status, 'inserted');
});

test('сообщение об ошибке: failed с причиной; для вставленного задания — конфликт', () => {
  const { queue, released } = setup();
  queue.submit(JOB_A, META);
  queue.leaseNext();
  assert.equal(queue.ack(JOB_A, { result: 'failed', reason: 'decode_failed', message: 'не читается' }).outcome, 'ok');
  const job = queue.get(JOB_A);
  assert.equal(job?.status, 'failed');
  assert.deepEqual(job?.error, { code: 'decode_failed', message: 'не читается' });
  assert.deepEqual(released, [JOB_A]);
  assert.equal(queue.ack(JOB_A, { result: 'failed', reason: 'insert_failed', message: '' }).outcome, 'ok');
  assert.equal(queue.get(JOB_A)?.error?.code, 'decode_failed');

  queue.submit(JOB_B, META);
  queue.ack(JOB_B, { result: 'inserted' });
  assert.equal(queue.ack(JOB_B, { result: 'failed', reason: 'insert_failed', message: '' }).outcome, 'conflict');
  assert.equal(queue.get(JOB_B)?.status, 'inserted');

  assert.equal(queue.ack(JOB_C, { result: 'inserted' }).outcome, 'not_found');
});

test('повторная загрузка существующего задания не меняет его', () => {
  const { queue } = setup();
  queue.submit(JOB_A, META);
  assert.equal(queue.acceptsUpload(JOB_A), false);
  queue.leaseNext();
  assert.equal(queue.acceptsUpload(JOB_A), false);
  queue.ack(JOB_A, { result: 'inserted' });
  assert.equal(queue.acceptsUpload(JOB_A), false);
  assert.equal(queue.get(JOB_A)?.status, 'inserted');
});

test('повторная загрузка после failed и expired возвращает задание в очередь с нулём попыток', () => {
  const { queue, advance } = setup();
  queue.submit(JOB_A, META);
  queue.leaseNext();
  queue.ack(JOB_A, { result: 'failed', reason: 'insert_failed', message: 'x' });
  assert.equal(queue.acceptsUpload(JOB_A), true);
  const again = queue.submit(JOB_A, META);
  assert.equal(again.status, 'queued');
  assert.equal(again.attempts, 0);
  assert.equal(again.error, null);

  queue.submit(JOB_B, META);
  advance(30 * MINUTE);
  assert.equal(queue.get(JOB_B)?.status, 'expired');
  assert.equal(queue.acceptsUpload(JOB_B), true);
  assert.equal(queue.submit(JOB_B, META).status, 'queued');
  advance(29 * MINUTE);
  assert.equal(queue.get(JOB_B)?.status, 'queued');
});

test('плагин активен 10 секунд после запроса и пока есть неистёкшая аренда', () => {
  const { queue, advance } = setup();
  assert.equal(queue.pluginConnected(), false);

  queue.leaseNext();
  assert.equal(queue.pluginConnected(), true);
  advance(10 * SECOND);
  assert.equal(queue.pluginConnected(), true);
  advance(SECOND);
  assert.equal(queue.pluginConnected(), false);

  queue.submit(JOB_A, META);
  queue.leaseNext();
  advance(45 * SECOND);
  assert.equal(queue.pluginConnected(), true);
  advance(15 * SECOND);
  assert.equal(queue.pluginConnected(), false);
});

// iframe плагина: опрос сервера, декодирование и уменьшение изображений, подтверждение вставки.
// Порядок обработки задания — раздел 5.6 спецификации.

import { fitWithinLimit } from './sizing.ts';

// Адрес зафиксирован: он записан в манифесте плагина.
const SERVER = 'http://localhost:8787';
const POLL_MS = 2000;
const OFFLINE_POLL_MS = 5000;

type Reply = Record<string, any>;

// --- связь с main-потоком ---

let nextRequestId = 1;
const waiting = new Map<number, (reply: Reply) => void>();

function callMain(message: Record<string, unknown>): Promise<Reply> {
  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    waiting.set(requestId, resolve);
    parent.postMessage({ pluginMessage: { ...message, requestId } }, '*');
  });
}

onmessage = (event: MessageEvent) => {
  const reply = event.data.pluginMessage as Reply | undefined;
  if (!reply) return;
  waiting.get(reply.requestId)?.(reply);
  waiting.delete(reply.requestId);
};

// --- запросы к серверу ---

let token = '';

async function api(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(SERVER + path, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// --- обработка одного задания ---

type Outcome =
  | { status: 'inserted' }
  | { status: 'skipped' }
  | { status: 'failed'; reason: 'decode_failed' | 'insert_failed'; message: string }
  // Файл получить не удалось: задания уже нет либо сервер недоступен. Подтверждать нечего.
  | { status: 'unavailable' };

async function processJob(jobId: string): Promise<Outcome> {
  const check = await callMain({ type: 'check', jobId });
  if (check.found) return { status: 'skipped' };

  let file: Blob;
  try {
    const response = await api(`/api/jobs/${jobId}/file`, {}, 30_000);
    if (!response.ok) return { status: 'unavailable' };
    file = await response.blob();
  } catch {
    return { status: 'unavailable' };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    return { status: 'failed', reason: 'decode_failed', message: String(error) };
  }

  // В Figma уходят исходные байты, а если изображение больше лимита — уменьшенная копия в PNG.
  const fit = fitWithinLimit(bitmap.width, bitmap.height);
  let payload = file;
  if (fit.resized) {
    const canvas = document.createElement('canvas');
    canvas.width = fit.width;
    canvas.height = fit.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, fit.width, fit.height);
    const resized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!resized) return { status: 'failed', reason: 'decode_failed', message: 'Не удалось уменьшить изображение' };
    payload = resized;
  }
  bitmap.close();

  const reply = await callMain({
    type: 'insert',
    jobId,
    bytes: new Uint8Array(await payload.arrayBuffer()),
    width: fit.width,
    height: fit.height,
  });
  if (!reply.ok) return { status: 'failed', reason: 'insert_failed', message: reply.error };
  return reply.found ? { status: 'skipped' } : { status: 'inserted' };
}

// --- подтверждения ---

// Подтверждения, которые сервер ещё не получил. Повторяются на каждом круге опроса.
const pendingAcks = new Map<string, Record<string, string>>();

async function flushAcks(): Promise<void> {
  for (const [jobId, body] of pendingAcks) {
    let response: Response;
    try {
      response = await api(`/api/jobs/${jobId}/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      return;
    }
    if (response.status === 401) return;
    // Любой другой ответ окончательный: принято, задания уже нет либо оно уже вставлено.
    pendingAcks.delete(jobId);
  }
}

// --- интерфейс ---

const element = (id: string) => document.getElementById(id) as HTMLElement;
const tokenInput = element('token') as HTMLInputElement;

let insertedCount = 0;
const errors: string[] = [];
// Пользователь открыл форму сам: обновление статуса не должно её закрывать.
let editingToken = false;

function show(status: string, options: { counters?: string; tokenForm?: boolean } = {}) {
  element('status').textContent = status;
  element('counters').textContent = options.counters ?? '';
  const formVisible = Boolean(options.tokenForm) || editingToken;
  element('tokenForm').hidden = !formVisible;
  element('changeToken').hidden = formVisible;
}

function addError(jobId: string, text: string) {
  const time = new Date().toLocaleTimeString();
  errors.unshift(`${time}, задание ${jobId.slice(0, 8)}: ${text}`);
  errors.length = Math.min(errors.length, 5);
  element('errorsBlock').hidden = false;
  element('errors').replaceChildren(...errors.map((line) => Object.assign(document.createElement('li'), { textContent: line })));
}

let tokenChanged = () => {};
function waitForToken(): Promise<void> {
  return new Promise((resolve) => (tokenChanged = resolve));
}

element('saveToken').onclick = async () => {
  token = tokenInput.value.trim();
  editingToken = false;
  await callMain({ type: 'saveToken', token });
  tokenChanged();
};

element('changeToken').onclick = () => {
  tokenInput.value = '';
  editingToken = true;
  element('tokenForm').hidden = false;
  element('changeToken').hidden = true;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// --- основной цикл ---

async function run() {
  token = (await callMain({ type: 'getToken' })).token;
  let insertedSinceScroll = false;

  while (true) {
    if (!token) {
      show('Введите токен сервера', { tokenForm: true });
      await waitForToken();
      show('Подключение к серверу…');
      continue;
    }

    await flushAcks();

    let response: Response;
    try {
      response = await api('/api/jobs/next');
    } catch {
      show('Сервер недоступен', { counters: 'Проверьте, что он запущен на этом компьютере. Плагин повторяет попытки.' });
      await sleep(OFFLINE_POLL_MS);
      continue;
    }
    if (response.status === 401) {
      show('Токен не подошёл', { tokenForm: true });
      await waitForToken();
      show('Подключение к серверу…');
      continue;
    }
    if (!response.ok) {
      show('Сервер ответил ошибкой', { counters: `Код ${response.status}. Плагин повторяет попытки.` });
      await sleep(OFFLINE_POLL_MS);
      continue;
    }

    const { job, pending } = await response.json();
    if (!job) {
      show('Подключено', { counters: `Ожидающих заданий: 0. Вставлено за сеанс: ${insertedCount}` });
      if (insertedSinceScroll) {
        insertedSinceScroll = false;
        await callMain({ type: 'queueEmpty' });
      }
      await sleep(POLL_MS);
      continue;
    }

    show('Вставляется…', { counters: `Ожидающих заданий: ${pending}. Вставлено за сеанс: ${insertedCount}` });
    const outcome = await processJob(job.id);
    if (outcome.status === 'unavailable') {
      await sleep(POLL_MS);
    } else if (outcome.status === 'failed') {
      pendingAcks.set(job.id, { result: 'failed', reason: outcome.reason, message: outcome.message });
      const text = outcome.reason === 'decode_failed' ? 'файл повреждён или не читается' : `Figma не приняла изображение: ${outcome.message}`;
      addError(job.id, text);
    } else {
      pendingAcks.set(job.id, { result: 'inserted' });
      if (outcome.status === 'inserted') {
        insertedCount++;
        insertedSinceScroll = true;
      }
    }
  }
}

run();

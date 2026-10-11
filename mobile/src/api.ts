// Запросы к серверу (раздел 6 спецификации).

import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { classifyHealth, type Connection } from './connection.ts';
import { fromStatusResponse, fromUploadResponse, type ItemState } from './status.ts';

export type Settings = { serverUrl: string; token: string };

const REQUEST_TIMEOUT_MS = 5_000;
const UPLOAD_TIMEOUT_MS = 60_000;

type Answer = { status: number; body: unknown };

// Сервер отвечает JSON, но по адресу может оказаться другое устройство с любым ответом.
async function parse(response: { status: number; text(): Promise<string> }): Promise<Answer> {
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) };
  } catch {
    return { status: response.status, body: text };
  }
}

// null означает сетевую ошибку или истёкшее время ожидания.
async function get(settings: Settings, path: string): Promise<Answer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(settings.serverUrl + path, {
      headers: { Authorization: `Bearer ${settings.token}` },
      signal: controller.signal,
    });
    return await parse(response);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(settings: Settings): Promise<Connection> {
  const answer = await get(settings, '/api/health');
  return classifyHealth(answer ? { kind: 'response', ...answer } : { kind: 'network' });
}

export type StatusCheck = { state: ItemState | null; problem: 'offline' | 'bad_token' | null };

export async function fetchStatus(settings: Settings, jobId: string): Promise<StatusCheck> {
  const answer = await get(settings, `/api/jobs/${jobId}`);
  if (!answer) return { state: null, problem: 'offline' };
  if (answer.status === 401) return { state: null, problem: 'bad_token' };
  return { state: fromStatusResponse(answer.status, answer.body), problem: null };
}

export async function uploadImage(settings: Settings, image: { id: string; uri: string; mimeType: string }): Promise<ItemState> {
  // fetch(uri).blob() на Android не читает файл из picker, поэтому байты читаются явно.
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await new File(image.uri).bytes();
  } catch {
    return { kind: 'uploadError', code: 'read_failed' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const response = await expoFetch(`${settings.serverUrl}/api/uploads`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        'Content-Type': image.mimeType,
        'X-Job-Id': image.id,
      },
      body: bytes,
      signal: controller.signal,
    });
    const answer = await parse(response);
    return fromUploadResponse(answer.status, answer.body);
  } catch {
    return { kind: 'uploadError', code: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

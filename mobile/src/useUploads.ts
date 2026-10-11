// Список выбранных изображений: отправка по одному, опрос статусов, состояние подключения.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import { checkHealth, fetchStatus, uploadImage, type Settings } from './api.ts';
import type { Connection } from './connection.ts';
import { describe, mimeTypeOf, needsPolling, type ItemState } from './status.ts';

const STATUS_POLL_MS = 2_000;
const HEALTH_POLL_MS = 5_000;

export type Item = { id: string; uri: string; mimeType: string; state: ItemState };

export type Uploads = ReturnType<typeof useUploads>;

export function useUploads(settings: Settings | null) {
  const [items, setItems] = useState<Item[]>([]);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [sending, setSending] = useState(false);

  // Актуальный список для асинхронных циклов: состояние React между рендерами устаревает.
  const store = useRef<Item[]>([]);
  const uploadQueue = useRef<string[]>([]);
  const busy = useRef({ sending: false, polling: false });

  const update = useCallback((change: (list: Item[]) => Item[]) => {
    store.current = change(store.current);
    setItems(store.current);
  }, []);

  const setState = useCallback(
    (id: string, state: ItemState) => update((list) => list.map((item) => (item.id === id ? { ...item, state } : item))),
    [update],
  );

  const refreshConnection = useCallback(async () => {
    if (settings) setConnection(await checkHealth(settings));
  }, [settings]);

  // Загружает изображения из очереди по одному, по порядку.
  const pump = useCallback(async () => {
    if (!settings || busy.current.sending) return;
    busy.current.sending = true;
    setSending(true);
    try {
      await refreshConnection();
      while (uploadQueue.current.length > 0) {
        const id = uploadQueue.current.shift() as string;
        const item = store.current.find((candidate) => candidate.id === id);
        if (!item) continue;
        const state = await uploadImage(settings, item);
        setState(id, state);
        if (state.kind === 'uploadError' && state.code === 'network') setConnection('offline');
        if (state.kind === 'uploadError' && state.code === 'unauthorized') setConnection('bad_token');
      }
    } finally {
      busy.current.sending = false;
      setSending(false);
    }
  }, [settings, refreshConnection, setState]);

  const enqueue = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      uploadQueue.current.push(...ids);
      update((list) => list.map((item) => (ids.includes(item.id) ? { ...item, state: { kind: 'uploading' } } : item)));
      void pump();
    },
    [pump, update],
  );

  // Идентификатор задания создаётся при выборе и не меняется при повторах (раздел 5.1).
  const add = useCallback(
    (assets: Array<{ uri: string; mimeType?: string | null }>) =>
      update((list) => [
        ...list,
        ...assets.map((asset) => ({
          id: Crypto.randomUUID(),
          uri: asset.uri,
          mimeType: mimeTypeOf(asset.mimeType, asset.uri),
          state: { kind: 'selected' } as ItemState,
        })),
      ]),
    [update],
  );

  const remove = useCallback((id: string) => update((list) => list.filter((item) => item.id !== id)), [update]);
  const clear = useCallback(() => update((list) => list.filter((item) => !describe(item.state).canRemove)), [update]);

  const send = useCallback(
    () => enqueue(store.current.filter((item) => item.state.kind === 'selected').map((item) => item.id)),
    [enqueue],
  );
  const retry = useCallback((id: string) => enqueue([id]), [enqueue]);
  const retryAll = useCallback(
    () => enqueue(store.current.filter((item) => describe(item.state).canRetry).map((item) => item.id)),
    [enqueue],
  );

  // Опрос статусов незавершённых заданий.
  useEffect(() => {
    if (!settings) return;
    const timer = setInterval(async () => {
      if (busy.current.polling) return;
      busy.current.polling = true;
      try {
        for (const item of store.current.filter((candidate) => needsPolling(candidate.state))) {
          const check = await fetchStatus(settings, item.id);
          if (check.problem) {
            setConnection(check.problem);
            break;
          }
          // Пока шёл запрос, пользователь мог нажать «Повторить»: тогда ответ уже неактуален.
          const current = store.current.find((candidate) => candidate.id === item.id);
          if (check.state && current && needsPolling(current.state)) setState(item.id, check.state);
        }
      } finally {
        busy.current.polling = false;
      }
    }, STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [settings, setState]);

  // Проверка подключения: при открытии, при возврате в приложение и пока есть незавершённые задания.
  useEffect(() => {
    void refreshConnection();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshConnection();
    });
    const timer = setInterval(() => {
      const active = store.current.some((item) => item.state.kind === 'uploading' || needsPolling(item.state));
      if (active) void refreshConnection();
    }, HEALTH_POLL_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [refreshConnection]);

  return { items, connection, sending, add, remove, clear, send, retry, retryAll };
}

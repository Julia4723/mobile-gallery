// Адрес сервера и токен в защищённом хранилище устройства.

import * as SecureStore from 'expo-secure-store';
import type { Settings } from './api.ts';
import { normalizeServerUrl } from './connection.ts';

const URL_KEY = 'serverUrl';
const TOKEN_KEY = 'token';

// Если пользователь ещё ничего не сохранял, берутся значения для разработки из .env.local.
export async function loadSettings(): Promise<Settings> {
  const [serverUrl, token] = await Promise.all([SecureStore.getItemAsync(URL_KEY), SecureStore.getItemAsync(TOKEN_KEY)]);
  return {
    serverUrl: normalizeServerUrl(serverUrl ?? process.env.EXPO_PUBLIC_SERVER_URL ?? ''),
    token: (token ?? process.env.EXPO_PUBLIC_TOKEN ?? '').trim(),
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await Promise.all([SecureStore.setItemAsync(URL_KEY, settings.serverUrl), SecureStore.setItemAsync(TOKEN_KEY, settings.token)]);
}

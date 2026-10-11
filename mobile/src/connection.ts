// Состояние подключения по ответу GET /api/health (раздел 9.3 спецификации).
// Чистые функции без React Native: проверяются тестами в Node.

export type Connection = 'offline' | 'foreign' | 'bad_token' | 'no_plugin' | 'ready';

export type HealthResult = { kind: 'network' } | { kind: 'response'; status: number; body: unknown };

export function classifyHealth(result: HealthResult): Connection {
  if (result.kind === 'network') return 'offline';
  const body = typeof result.body === 'object' && result.body !== null ? (result.body as Record<string, unknown>) : null;
  if (result.status !== 200 || body?.service !== 'mobile-gallery') return 'foreign';
  if (body.authorized !== true) return 'bad_token';
  return body.pluginConnected === true ? 'ready' : 'no_plugin';
}

export function connectionMessage(connection: Connection): string {
  switch (connection) {
    case 'offline':
      return 'Сервер недоступен';
    case 'foreign':
      return 'По этому адресу отвечает другое устройство. Проверьте адрес сервера';
    case 'bad_token':
      return 'Токен неверный';
    case 'no_plugin':
      return 'Плагин в Figma не запущен. Изображения подождут в очереди до 30 минут';
    case 'ready':
      return 'Сервер доступен, токен верный, плагин запущен';
  }
}

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

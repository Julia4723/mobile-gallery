// Токен доступа: временный механизм авторизации для личного MVP (раздел 10 спецификации).

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Читает токен из файла, а при первом запуске создаёт его.
export async function loadOrCreateToken(file: string): Promise<string> {
  try {
    const saved = (await readFile(file, 'utf8')).trim();
    if (saved) return saved;
  } catch {
    // Файла ещё нет.
  }
  const token = randomBytes(16).toString('hex');
  await writeFile(file, token + '\n', { mode: 0o600 });
  return token;
}

// Сравнение за постоянное время. Токен принимается только из заголовка Authorization.
export function isAuthorized(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

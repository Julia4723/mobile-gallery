// Список идентификаторов вставленных заданий (раздел 5.6 спецификации).

export const INSERTED_LIMIT = 500;

export function addInserted(list: string[], id: string): string[] {
  if (list.includes(id)) return list;
  return [...list, id].slice(-INSERTED_LIMIT);
}

// Данные плагина хранятся строкой. Пустая или испорченная строка читается как пустой список.
export function parseInserted(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

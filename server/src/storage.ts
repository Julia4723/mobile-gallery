// Временное хранилище файлов заданий. Имя файла — идентификатор задания (UUID).

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type Storage = {
  // Удаляет всё, что осталось от прошлого запуска: очередь в памяти, поэтому старые файлы никому не нужны.
  init(): Promise<void>;
  write(id: string, bytes: Buffer): Promise<void>;
  read(id: string): Promise<Buffer | null>;
  remove(id: string): Promise<void>;
};

export function createStorage(directory: string): Storage {
  const file = (id: string) => path.join(directory, id);
  return {
    async init() {
      await rm(directory, { recursive: true, force: true });
      await mkdir(directory, { recursive: true, mode: 0o700 });
    },
    async write(id, bytes) {
      await writeFile(file(id), bytes, { mode: 0o600 });
    },
    async read(id) {
      try {
        return await readFile(file(id));
      } catch {
        return null;
      }
    },
    async remove(id) {
      await rm(file(id), { force: true });
    },
  };
}

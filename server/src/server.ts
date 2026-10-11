// Запуск сервера ровно на двух адресах: 127.0.0.1 для плагина и адрес одного интерфейса для телефона.
// На каждый адрес — свой экземпляр приложения с общей очередью.

import type { FastifyInstance } from 'fastify';

export type Running = { addresses: string[]; close(): Promise<void> };

export async function startServers(options: {
  port: number;
  lanAddress: string | null;
  createApp: () => FastifyInstance;
}): Promise<Running> {
  const hosts = ['127.0.0.1', ...(options.lanAddress ? [options.lanAddress] : [])];
  const apps: FastifyInstance[] = [];
  try {
    for (const host of hosts) {
      const app = options.createApp();
      apps.push(app);
      await app.listen({ host, port: options.port });
    }
  } catch (error) {
    await Promise.all(apps.map((app) => app.close()));
    throw error;
  }
  return {
    addresses: hosts,
    close: async () => {
      await Promise.all(apps.map((app) => app.close()));
    },
  };
}

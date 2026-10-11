// HTTP API (раздел 6 спецификации).

import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { MAX_FILE_BYTES } from './config.ts';
import { inspectImage } from './image.ts';
import type { Ack, JobQueue } from './queue.ts';
import type { Storage } from './storage.ts';
import { isAuthorized } from './token.ts';

export type AppDeps = { queue: JobQueue; storage: Storage; token: string };

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif'];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MESSAGES: Record<string, string> = {
  unauthorized: 'Нужен заголовок Authorization: Bearer <токен>',
  invalid_job_id: 'Заголовок X-Job-Id должен содержать UUID v4',
  file_too_large: 'Файл больше 20 МБ',
  unsupported_type: 'Поддерживаются PNG, JPEG и GIF; содержимое должно совпадать с Content-Type',
  invalid_dimensions: 'Размеры изображения не читаются или превышают 16 384 px по стороне либо 50 Мп',
  invalid_ack: 'Ожидается {"result":"inserted"} или {"result":"failed","reason":"decode_failed|insert_failed"}',
  job_not_found: 'Задание не найдено',
  file_gone: 'Файл задания уже удалён',
  job_finished: 'Задание уже вставлено',
  invalid_request: 'Некорректный запрос',
  not_found: 'Нет такого адреса',
  internal_error: 'Внутренняя ошибка сервера',
};

function fail(reply: FastifyReply, status: number, code: string) {
  return reply.code(status).send({ error: { code, message: MESSAGES[code] } });
}

function parseAck(body: unknown): Ack | null {
  if (typeof body !== 'object' || body === null) return null;
  const { result, reason, message } = body as Record<string, unknown>;
  if (result === 'inserted') return { result };
  if (result === 'failed' && (reason === 'decode_failed' || reason === 'insert_failed')) {
    return { result, reason, message: typeof message === 'string' ? message.slice(0, 500) : '' };
  }
  return null;
}

export function buildApp({ queue, storage, token }: AppDeps): FastifyInstance {
  const app = Fastify({ bodyLimit: MAX_FILE_BYTES });

  for (const type of IMAGE_TYPES) {
    app.addContentTypeParser(type, { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  }

  // У iframe плагина Figma origin равен null, поэтому нужен Allow-Origin: *.
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    reply.header('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS') return reply.code(204).send();

    const open = request.method === 'GET' && request.url.split('?')[0] === '/api/health';
    if (!open && !isAuthorized(request.headers.authorization, token)) return fail(reply, 401, 'unauthorized');
  });

  app.setNotFoundHandler((_request, reply) => fail(reply, 404, 'not_found'));

  app.setErrorHandler((error: { statusCode?: number }, _request, reply) => {
    const status = error.statusCode ?? 500;
    if (status === 413) return fail(reply, 413, 'file_too_large');
    if (status === 415) return fail(reply, 415, 'unsupported_type');
    if (status >= 400 && status < 500) return fail(reply, status, 'invalid_request');
    console.error(error);
    return fail(reply, 500, 'internal_error');
  });

  app.options('/*', async (_request, reply) => reply.code(204).send());

  app.get('/api/health', async (request) => ({
    service: 'mobile-gallery',
    ok: true,
    authorized: isAuthorized(request.headers.authorization, token),
    pluginConnected: queue.pluginConnected(),
  }));

  app.post(
    '/api/uploads',
    {
      // Идентификатор проверяется до чтения тела запроса.
      onRequest: async (request, reply) => {
        const id = request.headers['x-job-id'];
        if (typeof id !== 'string' || !UUID_V4.test(id)) return fail(reply, 400, 'invalid_job_id');
      },
    },
    async (request, reply) => {
      const id = (request.headers['x-job-id'] as string).toLowerCase();

      // Повтор существующего задания: тело запроса игнорируется.
      if (!queue.acceptsUpload(id)) return queue.get(id);

      const bytes = request.body;
      if (!Buffer.isBuffer(bytes)) return fail(reply, 415, 'unsupported_type');
      const inspection = inspectImage(bytes);
      if (!inspection.ok) return fail(reply, inspection.code === 'unsupported_type' ? 415 : 422, inspection.code);
      const declared = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (declared !== inspection.mimeType) return fail(reply, 415, 'unsupported_type');

      await storage.write(id, bytes);
      const { mimeType, width, height } = inspection;
      return reply.code(201).send(queue.submit(id, { mimeType, bytes: bytes.length, width, height }));
    },
  );

  app.get('/api/jobs/next', async () => {
    const job = queue.leaseNext();
    return { job, pending: queue.pending() };
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id/file', async (request, reply) => {
    queue.touchPlugin();
    const job = queue.get(request.params.id);
    if (!job) return fail(reply, 404, 'job_not_found');
    const bytes = job.status === 'queued' || job.status === 'leased' ? await storage.read(job.id) : null;
    if (!bytes) return fail(reply, 410, 'file_gone');
    return reply.type(job.mimeType).send(bytes);
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (request, reply) => {
    return queue.get(request.params.id) ?? fail(reply, 404, 'job_not_found');
  });

  app.post<{ Params: { id: string } }>('/api/jobs/:id/ack', async (request, reply) => {
    queue.touchPlugin();
    const ack = parseAck(request.body);
    if (!ack) return fail(reply, 400, 'invalid_ack');
    const result = queue.ack(request.params.id, ack);
    if (result.outcome === 'not_found') return fail(reply, 404, 'job_not_found');
    if (result.outcome === 'conflict') return fail(reply, 409, 'job_finished');
    return result.job;
  });

  return app;
}

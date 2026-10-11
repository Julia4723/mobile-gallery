// Очередь заданий в памяти (раздел 5 спецификации).
// Время приходит снаружи, поэтому сроки проверяются тестами без реального ожидания.

import { LEASE_MS, MAX_ATTEMPTS, PLUGIN_SEEN_MS, QUEUE_TTL_MS, RECORD_TTL_MS } from './config.ts';

export type Status = 'queued' | 'leased' | 'inserted' | 'failed' | 'expired';
export type FailureCode = 'decode_failed' | 'insert_failed' | 'plugin_no_ack';

export type JobMeta = { mimeType: string; bytes: number; width: number; height: number };

export type Job = JobMeta & {
  id: string;
  status: Status;
  attempts: number;
  error: { code: FailureCode; message: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type Ack =
  | { result: 'inserted' }
  | { result: 'failed'; reason: 'decode_failed' | 'insert_failed'; message: string };

export type AckOutcome = { outcome: 'ok'; job: Job } | { outcome: 'not_found' } | { outcome: 'conflict' };

type Entry = {
  job: Job;
  createdMs: number;
  // Начало отсчёта 30 минут ожидания в очереди.
  queuedMs: number;
  leaseUntilMs: number;
  finishedMs: number;
};

const FINAL: Status[] = ['inserted', 'failed', 'expired'];

export class JobQueue {
  private readonly now: () => number;
  private readonly releaseFile: (id: string) => void;
  private readonly entries = new Map<string, Entry>();
  private pluginSeenMs: number | null = null;

  // releaseFile вызывается, когда файл задания больше не нужен.
  constructor(now: () => number, releaseFile: (id: string) => void) {
    this.now = now;
    this.releaseFile = releaseFile;
  }

  // Новая загрузка принимается, если задания нет либо оно завершилось неудачей.
  acceptsUpload(id: string): boolean {
    this.sweep();
    const entry = this.entries.get(id);
    return !entry || entry.job.status === 'failed' || entry.job.status === 'expired';
  }

  submit(id: string, meta: JobMeta): Job {
    const now = this.now();
    const existing = this.entries.get(id);
    const entry: Entry = {
      job: {
        id,
        status: 'queued',
        ...meta,
        attempts: 0,
        error: null,
        createdAt: existing?.job.createdAt ?? new Date(now).toISOString(),
        updatedAt: new Date(now).toISOString(),
      },
      createdMs: existing?.createdMs ?? now,
      queuedMs: now,
      leaseUntilMs: 0,
      finishedMs: 0,
    };
    this.entries.set(id, entry);
    return entry.job;
  }

  get(id: string): Job | null {
    this.sweep();
    return this.entries.get(id)?.job ?? null;
  }

  pending(): number {
    this.sweep();
    return this.queued().length;
  }

  // Выдаёт плагину самое старое задание из очереди.
  leaseNext(): Job | null {
    this.touchPlugin();
    this.sweep();
    const entry = this.queued().sort((a, b) => a.createdMs - b.createdMs)[0];
    if (!entry) return null;
    entry.leaseUntilMs = this.now() + LEASE_MS;
    this.update(entry, { status: 'leased', attempts: entry.job.attempts + 1 });
    return entry.job;
  }

  ack(id: string, ack: Ack): AckOutcome {
    this.sweep();
    const entry = this.entries.get(id);
    if (!entry) return { outcome: 'not_found' };
    const status = entry.job.status;

    if (ack.result === 'inserted') {
      // Принимается из любого состояния: изображение уже в Figma.
      if (status !== 'inserted') this.finish(entry, { status: 'inserted', error: null });
      return { outcome: 'ok', job: entry.job };
    }

    if (status === 'inserted') return { outcome: 'conflict' };
    if (status === 'queued' || status === 'leased') {
      this.finish(entry, { status: 'failed', error: { code: ack.reason, message: ack.message } });
    }
    return { outcome: 'ok', job: entry.job };
  }

  touchPlugin(): void {
    this.pluginSeenMs = this.now();
  }

  pluginConnected(): boolean {
    this.sweep();
    const seenRecently = this.pluginSeenMs !== null && this.now() - this.pluginSeenMs <= PLUGIN_SEEN_MS;
    return seenRecently || [...this.entries.values()].some((entry) => entry.job.status === 'leased');
  }

  // Применяет истёкшие сроки. Вызывается по таймеру и перед каждым обращением к очереди.
  sweep(): void {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.job.status === 'leased' && now >= entry.leaseUntilMs) {
        if (entry.job.attempts < MAX_ATTEMPTS) {
          this.update(entry, { status: 'queued' });
        } else {
          const message = 'Плагин трижды забрал задание и не ответил';
          this.finish(entry, { status: 'failed', error: { code: 'plugin_no_ack', message } });
        }
      }
      if (entry.job.status === 'queued' && now >= entry.queuedMs + QUEUE_TTL_MS) {
        this.finish(entry, { status: 'expired' });
      }
      if (FINAL.includes(entry.job.status) && now >= entry.finishedMs + RECORD_TTL_MS) {
        this.entries.delete(id);
      }
    }
  }

  private queued(): Entry[] {
    return [...this.entries.values()].filter((entry) => entry.job.status === 'queued');
  }

  private update(entry: Entry, changes: Partial<Job>): void {
    entry.job = { ...entry.job, ...changes, updatedAt: new Date(this.now()).toISOString() };
  }

  private finish(entry: Entry, changes: Partial<Job>): void {
    this.update(entry, changes);
    entry.finishedMs = this.now();
    this.releaseFile(entry.job.id);
  }
}

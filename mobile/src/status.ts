// Состояние одного изображения на телефоне и его показ пользователю (раздел 5.7 спецификации).
// Чистые функции без React Native: проверяются тестами в Node.

export type JobStatus = 'queued' | 'leased' | 'inserted' | 'failed' | 'expired';

export type UploadErrorCode =
  | 'network'
  | 'unauthorized'
  | 'file_too_large'
  | 'unsupported_type'
  | 'invalid_dimensions'
  | 'read_failed'
  | 'server';

export type ItemState =
  | { kind: 'selected' }
  | { kind: 'uploading' }
  | { kind: 'uploadError'; code: UploadErrorCode }
  | { kind: 'job'; status: JobStatus; errorCode: string | null; errorMessage: string }
  // Сервер не знает задание: он был перезапущен.
  | { kind: 'unknown' };

export type StatusView = {
  label: string;
  tone: 'neutral' | 'progress' | 'success' | 'error';
  canRetry: boolean;
  canRemove: boolean;
};

const JOB_STATUSES: JobStatus[] = ['queued', 'leased', 'inserted', 'failed', 'expired'];

const UPLOAD_ERRORS: Record<UploadErrorCode, { label: string; canRetry: boolean }> = {
  network: { label: 'Нет связи с сервером', canRetry: true },
  unauthorized: { label: 'Токен неверный', canRetry: true },
  read_failed: { label: 'Не удалось прочитать файл на телефоне', canRetry: true },
  server: { label: 'Сервер ответил ошибкой', canRetry: true },
  // Повтор не поможет: сервер отклонит тот же файл снова.
  file_too_large: { label: 'Файл больше 20 МБ', canRetry: false },
  unsupported_type: { label: 'Формат не поддерживается. Подходят PNG, JPEG, GIF', canRetry: false },
  invalid_dimensions: { label: 'Изображение слишком большое', canRetry: false },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function jobState(body: unknown): ItemState | null {
  const job = asRecord(body);
  if (!job || !JOB_STATUSES.includes(job.status as JobStatus)) return null;
  const error = asRecord(job.error);
  return {
    kind: 'job',
    status: job.status as JobStatus,
    errorCode: typeof error?.code === 'string' ? error.code : null,
    errorMessage: typeof error?.message === 'string' ? error.message : '',
  };
}

export function fromUploadResponse(status: number, body: unknown): ItemState {
  if (status === 200 || status === 201) return jobState(body) ?? { kind: 'uploadError', code: 'server' };
  const code = asRecord(asRecord(body)?.error)?.code;
  if (typeof code === 'string' && code in UPLOAD_ERRORS) return { kind: 'uploadError', code: code as UploadErrorCode };
  return { kind: 'uploadError', code: 'server' };
}

// null означает «статус узнать не удалось, оставить прежний».
export function fromStatusResponse(status: number, body: unknown): ItemState | null {
  if (status === 404) return { kind: 'unknown' };
  if (status !== 200) return null;
  return jobState(body);
}

export function needsPolling(state: ItemState): boolean {
  return state.kind === 'job' && (state.status === 'queued' || state.status === 'leased');
}

export function describe(state: ItemState): StatusView {
  switch (state.kind) {
    case 'selected':
      return { label: '', tone: 'neutral', canRetry: false, canRemove: true };
    case 'uploading':
      return { label: 'Отправка…', tone: 'progress', canRetry: false, canRemove: false };
    case 'uploadError':
      return { ...UPLOAD_ERRORS[state.code], tone: 'error', canRemove: true };
    case 'unknown':
      return { label: 'Сервер был перезапущен. Повтор не создаст дубликат', tone: 'error', canRetry: true, canRemove: true };
    case 'job':
      break;
  }

  switch (state.status) {
    case 'queued':
      return { label: 'В очереди', tone: 'progress', canRetry: false, canRemove: false };
    case 'leased':
      return { label: 'Вставляется…', tone: 'progress', canRetry: false, canRemove: false };
    case 'inserted':
      return { label: 'Вставлено', tone: 'success', canRetry: false, canRemove: true };
    case 'expired':
      return { label: 'Плагин не забрал изображение за 30 минут', tone: 'error', canRetry: true, canRemove: true };
    case 'failed':
      break;
  }

  if (state.errorCode === 'decode_failed') {
    return { label: 'Файл повреждён или не читается', tone: 'error', canRetry: false, canRemove: true };
  }
  if (state.errorCode === 'plugin_no_ack') {
    const label = 'Плагин не подтвердил вставку. Проверьте страницу в Figma. Повтор не создаст дубликат';
    return { label, tone: 'error', canRetry: true, canRemove: true };
  }
  return { label: `Figma не приняла изображение: ${state.errorMessage}`, tone: 'error', canRetry: true, canRemove: true };
}

// Picker не всегда сообщает тип файла, тогда он определяется по расширению.
export function mimeTypeOf(reported: string | null | undefined, uri: string): string {
  if (reported) return reported;
  const extension = uri.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'gif') return 'image/gif';
  return 'application/octet-stream';
}

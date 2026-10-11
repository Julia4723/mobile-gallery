// Постоянные значения из спецификации (docs/spec.md).

// Порт зафиксирован: он записан в манифесте плагина.
export const PORT = 8787;

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_SIDE = 16_384;
export const MAX_PIXELS = 50_000_000;

export const LEASE_MS = 60_000;
export const MAX_ATTEMPTS = 3;
export const QUEUE_TTL_MS = 30 * 60_000;
export const RECORD_TTL_MS = 60 * 60_000;
export const PLUGIN_SEEN_MS = 10_000;
export const SWEEP_INTERVAL_MS = 5_000;

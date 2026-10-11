// Проверка загруженного файла по содержимому (раздел 4.1 спецификации).
// Читается только заголовок: тип и размеры в пикселях. Изображение не декодируется.

import { MAX_PIXELS, MAX_SIDE } from './config.ts';

export type MimeType = 'image/png' | 'image/jpeg' | 'image/gif';

export type Inspection =
  | { ok: true; mimeType: MimeType; width: number; height: number }
  | { ok: false; code: 'unsupported_type' | 'invalid_dimensions' };

type Size = { width: number; height: number };

function detectType(bytes: Buffer): MimeType | null {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const signature = bytes.toString('latin1', 0, 6);
  if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
  return null;
}

function pngSize(bytes: Buffer): Size | null {
  if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function gifSize(bytes: Buffer): Size | null {
  if (bytes.length < 10) return null;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

// Размеры JPEG лежат в сегменте заголовка кадра (SOF), перед которым идут сегменты произвольной длины.
function jpegSize(bytes: Buffer): Size | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Маркеры без длины: RST0–RST7, SOI, EOI, TEM.
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (offset + 9 > bytes.length) return null;
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  return null;
}

export function inspectImage(bytes: Buffer): Inspection {
  const mimeType = detectType(bytes);
  if (!mimeType) return { ok: false, code: 'unsupported_type' };

  const size = mimeType === 'image/png' ? pngSize(bytes) : mimeType === 'image/gif' ? gifSize(bytes) : jpegSize(bytes);
  const valid =
    size !== null &&
    size.width >= 1 &&
    size.height >= 1 &&
    size.width <= MAX_SIDE &&
    size.height <= MAX_SIDE &&
    size.width * size.height <= MAX_PIXELS;
  if (!valid) return { ok: false, code: 'invalid_dimensions' };

  return { ok: true, mimeType, width: size.width, height: size.height };
}

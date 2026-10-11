import { NODE_WIDTH } from './layout.ts';

// Figma принимает изображения не больше 4096 px по каждой стороне.
export const FIGMA_MAX_SIDE = 4096;

export function nodeSize(width: number, height: number): { width: number; height: number } {
  return { width: NODE_WIDTH, height: Math.max(1, Math.round((NODE_WIDTH * height) / width)) };
}

export function fitWithinLimit(width: number, height: number): { width: number; height: number; resized: boolean } {
  const scale = Math.min(1, FIGMA_MAX_SIDE / Math.max(width, height));
  if (scale === 1) return { width, height, resized: false };
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  };
}

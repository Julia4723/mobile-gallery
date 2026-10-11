// Раскладка по разделу 4.5 спецификации. Чистые функции без обращения к Figma.

export const NODE_WIDTH = 400;
export const GAP = 40;
export const COLUMNS = 5;
export const BLOCK_GAP = 100;

export type Box = { x: number; y: number; width: number; height: number };

export type LayoutState = { originX: number; rowY: number; rowHeight: number; col: number };

// Данные плагина хранятся строкой. Пустая или испорченная строка читается как отсутствие состояния.
export function parseLayout(raw: string): LayoutState | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (!value) return null;
    const { originX, rowY, rowHeight, col } = value;
    const fields = [originX, rowY, rowHeight, col];
    if (!fields.every((field) => typeof field === 'number' && Number.isFinite(field))) return null;
    return { originX, rowY, rowHeight, col } as LayoutState;
  } catch {
    return null;
  }
}

// Наложение площадей. Касание краями пересечением не считается.
export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function candidate(state: LayoutState, height: number): Box {
  return { x: state.originX + state.col * (NODE_WIDTH + GAP), y: state.rowY, width: NODE_WIDTH, height };
}

// Новый блок начинается ниже всего содержимого страницы, поэтому пересечений в нём быть не может.
function newBlock(occupied: Box[]): LayoutState {
  if (occupied.length === 0) return { originX: 0, rowY: 0, rowHeight: 0, col: 0 };
  return {
    originX: Math.min(...occupied.map((box) => box.x)),
    rowY: Math.max(...occupied.map((box) => box.y + box.height)) + BLOCK_GAP,
    rowHeight: 0,
    col: 0,
  };
}

export function place(saved: LayoutState | null, occupied: Box[], height: number): { box: Box; state: LayoutState } {
  let state = saved;
  if (state && state.col >= COLUMNS) {
    state = { originX: state.originX, rowY: state.rowY + state.rowHeight + GAP, rowHeight: 0, col: 0 };
  }

  let box = state ? candidate(state, height) : null;
  if (!state || !box || occupied.some((other) => intersects(box as Box, other))) {
    state = newBlock(occupied);
    box = candidate(state, height);
  }

  return {
    box,
    state: { originX: state.originX, rowY: state.rowY, rowHeight: Math.max(state.rowHeight, height), col: state.col + 1 },
  };
}

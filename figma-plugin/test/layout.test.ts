import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intersects, parseLayout, place, type Box, type LayoutState } from '../src/layout.ts';

// Вставляет подряд узлы заданной высоты так же, как это делает плагин:
// каждый вставленный узел становится занятой областью для следующих.
function placeAll(heights: number[], occupied: Box[], state: LayoutState | null = null) {
  const placed: Box[] = [];
  for (const height of heights) {
    const result = place(state, [...occupied, ...placed], height);
    for (const box of [...occupied, ...placed]) {
      assert.equal(intersects(result.box, box), false, 'новый узел пересёк занятую область');
    }
    placed.push(result.box);
    state = result.state;
  }
  return { placed, state };
}

test('пустая страница: первый узел в точке (0, 0)', () => {
  const { placed } = placeAll([300], []);
  assert.deepEqual(placed[0], { x: 0, y: 0, width: 400, height: 300 });
});

test('страница с контентом: у левого края контента, на 100 px ниже нижней границы', () => {
  const content: Box[] = [
    { x: 50, y: 0, width: 800, height: 600 },
    { x: -120, y: 200, width: 100, height: 900 },
  ];
  const { placed } = placeAll([300], content);
  assert.deepEqual(placed[0], { x: -120, y: 1200, width: 400, height: 300 });
});

test('семь изображений: пять в первой строке с шагом 440 px, два во второй', () => {
  const { placed } = placeAll([300, 300, 300, 300, 300, 300, 300], []);
  assert.deepEqual(placed.slice(0, 5).map((box) => box.x), [0, 440, 880, 1320, 1760]);
  assert.deepEqual(placed.slice(0, 5).map((box) => box.y), [0, 0, 0, 0, 0]);
  assert.deepEqual(placed.slice(5).map((box) => [box.x, box.y]), [[0, 340], [440, 340]]);
});

test('вторая строка начинается на 40 px ниже самого высокого узла первой', () => {
  const { placed } = placeAll([300, 900, 200, 300, 300, 100], []);
  assert.equal(placed[5].y, 940);
  assert.equal(placed[5].x, 0);
});

test('повторная отправка продолжает сетку со следующей свободной ячейки', () => {
  const first = placeAll([300, 300], []);
  const second = placeAll([300], first.placed, first.state);
  assert.deepEqual(second.placed[0], { x: 880, y: 0, width: 400, height: 300 });
});

test('занятая чужим объектом ячейка: новый блок ниже всего контента', () => {
  const first = placeAll([300, 300], []);
  const foreign: Box = { x: 900, y: 50, width: 50, height: 50 };
  const second = placeAll([300, 300], [...first.placed, foreign], first.state);
  assert.deepEqual(second.placed[0], { x: 0, y: 400, width: 400, height: 300 });
  assert.deepEqual(second.placed[1], { x: 440, y: 400, width: 400, height: 300 });
});

test('контент сдвинут под сетку: следующая строка не накладывается на него', () => {
  const first = placeAll([300, 300, 300, 300, 300], []);
  const moved: Box = { x: 100, y: 320, width: 600, height: 1000 };
  const second = placeAll([300], [...first.placed, moved], first.state);
  assert.deepEqual(second.placed[0], { x: 0, y: 1420, width: 400, height: 300 });
});

test('касание краями пересечением не считается', () => {
  const a: Box = { x: 0, y: 0, width: 400, height: 300 };
  assert.equal(intersects(a, { x: 400, y: 0, width: 10, height: 10 }), false);
  assert.equal(intersects(a, { x: 0, y: 300, width: 10, height: 10 }), false);
  assert.equal(intersects(a, { x: 399, y: 299, width: 10, height: 10 }), true);
});

test('длинная серия со случайными высотами и чужими объектами не даёт пересечений', () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const occupied: Box[] = [{ x: -300, y: -200, width: 2500, height: 150 }];
  let state: LayoutState | null = null;
  for (let round = 0; round < 20; round++) {
    const heights = Array.from({ length: 1 + Math.floor(random() * 8) }, () => 1 + Math.floor(random() * 1200));
    const result = placeAll(heights, occupied, state);
    occupied.push(...result.placed);
    state = result.state;
    occupied.push({ x: random() * 2500 - 300, y: random() * 6000, width: 1 + random() * 500, height: 1 + random() * 500 });
  }
});

test('сохранённое состояние раскладки: пустое и испорченное читается как отсутствующее', () => {
  assert.equal(parseLayout(''), null);
  assert.equal(parseLayout('не json'), null);
  assert.equal(parseLayout('{"originX":0,"rowY":0}'), null);
  assert.equal(parseLayout('{"originX":0,"rowY":"1","rowHeight":0,"col":0}'), null);
  assert.deepEqual(parseLayout('{"originX":-5,"rowY":340,"rowHeight":300,"col":2}'), { originX: -5, rowY: 340, rowHeight: 300, col: 2 });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addInserted, parseInserted } from '../src/inserted.ts';

test('добавленный идентификатор находится в списке', () => {
  const list = addInserted(addInserted([], 'a'), 'b');
  assert.deepEqual(list, ['a', 'b']);
  assert.equal(list.includes('a'), true);
});

test('повторное добавление не создаёт вторую запись', () => {
  assert.deepEqual(addInserted(['a', 'b'], 'a'), ['a', 'b']);
});

test('список хранит не больше 500 идентификаторов, вытесняя самые старые', () => {
  let list: string[] = [];
  for (let i = 0; i < 600; i++) list = addInserted(list, `id-${i}`);
  assert.equal(list.length, 500);
  assert.equal(list[0], 'id-100');
  assert.equal(list[499], 'id-599');
});

test('пустые и испорченные сохранённые данные читаются как пустой список', () => {
  assert.deepEqual(parseInserted(''), []);
  assert.deepEqual(parseInserted('не json'), []);
  assert.deepEqual(parseInserted('{"a":1}'), []);
  assert.deepEqual(parseInserted('["a",5,"b"]'), ['a', 'b']);
});

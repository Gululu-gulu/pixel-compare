import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_HISTORY, ORIGINAL, IDENTITY, commit, undo, redo, matrix, normalizeTransform, parseAdjustments, isAdjusted } from '../src/alignment.ts';
import { planUpdates } from '../src/updates.ts';

test('批量更新按主文件名匹配已有组，排除重名、未知名称和非图片', () => {
  const result = planUpdates(['1', '2', '10'], ['2.jpg', '10.png', '1.jpg', '1.webp', 'new.png', 'notes.txt'].map(name => ({ name })));
  assert.deepEqual([...result.updates.keys()], ['2', '10']);
  assert.equal(result.skipped.length, 3);
  assert.match(result.skipped.join(' '), /同名/);
  assert.match(result.skipped.join(' '), /没有对应/);
  assert.match(result.skipped.join(' '), /不支持/);
});

test('撤销/重做独立保留双层参数，新操作清空重做历史', () => {
  const a = { ...ORIGINAL, clear: { ...IDENTITY, x: 3 } };
  const b = { ...a, hazy: { ...IDENTITY, rotation: .25 } };
  const second = commit(commit(EMPTY_HISTORY, a), b);
  assert.deepEqual(undo(second).present, a);
  assert.deepEqual(redo(undo(second)).present, b);
  const branch = commit(undo(second), { ...a, clear: { ...a.clear, y: 2 } });
  assert.equal(branch.future.length, 0);
  assert.equal(branch.present.hazy.rotation, 0);
  assert.equal(EMPTY_HISTORY.present.clear.x, 0);
  assert.equal(commit(second, second.present), second);
  let many = EMPTY_HISTORY;
  for (let x = 1; x <= 120; x++) many = commit(many, { ...ORIGINAL, clear: { ...IDENTITY, x } });
  assert.equal(many.past.length, 100);
});

test('矩阵围绕图片中心旋转/缩放，位移以原图坐标计且最后应用', () => {
  assert.deepEqual(matrix(IDENTITY, 1280, 800), [1, 0, -0, 1, 0, 0]);
  assert.deepEqual(matrix({ ...IDENTITY, x: 3, y: -2 }, 1280, 800), [1, 0, -0, 1, 3, -2]);
  const [a,b,c,d,e,f] = matrix({ x: 7, y: -4, scale: 1.4, rotation: 30 }, 1280, 800);
  assert.ok(Math.abs(a * 640 + c * 400 + e - 647) < 1e-9);
  assert.ok(Math.abs(b * 640 + d * 400 + f - 396) < 1e-9);
  assert.deepEqual(normalizeTransform({ x: .1 + .2, y: 2e6, scale: 0, rotation: 999 }), { x: .3, y: 1e6, scale: .01, rotation: 360 });
});

test('参数文件严格校验、拒绝非法或重复项，不静默应用部分坏数据', () => {
  const valid = { version: 1, pairs: [{ name: '1', ...ORIGINAL, clear: { ...IDENTITY, x: .1, scale: 1.0001 } }] };
  const result = parseAdjustments(JSON.stringify(valid));
  assert.equal(result.get('1')!.clear.x, .1);
  assert.equal(isAdjusted(result.get('1')!), true);
  for (const invalid of [null, { version: 2, pairs: [] }, { version: 1, pairs: [{ name: '1', hazy: IDENTITY, clear: { ...IDENTITY, scale: 0 } }] }, { ...valid, pairs: [...valid.pairs, ...valid.pairs] }, { version: 1, pairs: [{ name: '1', hazy: IDENTITY, clear: { ...IDENTITY, x: '3' } }] }]) assert.throws(() => parseAdjustments(JSON.stringify(invalid)));
});

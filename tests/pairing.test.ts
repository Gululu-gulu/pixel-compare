import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairFiles, readFolder, readRoot } from '../src/pairing.ts';

const file = (name: string, path = '') => ({ name, webkitRelativePath: path });

test('按主文件名精确配对，支持不同扩展名，使用自然排序', () => {
  const result = pairFiles(['10.png', '2.JPG', '1.webp'].map(n => file(n)), ['2.png', '1.jpg', '10.jpeg'].map(n => file(n)));
  assert.deepEqual(result.pairs.map(p => p.name), ['1', '2', '10']);
  assert.equal(result.pairs[1].hazy.name, '2.JPG');
  assert.equal(result.pairs[1].clear.name, '2.png');
  assert.equal(result.issues.length, 0);
});

test('排除重复主文件名，不按顺序猜测，并报告缺失侧', () => {
  const result = pairFiles(['1.jpg', '1.png', '2.png', '4.jpg'].map(n => file(n)), ['1.webp', '3.png', '4.png'].map(n => file(n)));
  assert.deepEqual(result.pairs.map(p => p.name), ['4']);
  assert.equal(result.ambiguousCount, 2);
  assert.equal(result.missingCount, 2);
  assert.match(result.issues.find(i => i.name === '2')!.detail, /缺少 clear/);
  assert.match(result.issues.find(i => i.name === '3')!.detail, /缺少 hazy/);
});

test('歧义与缺失可以同时报告，区分大小写，忽略非图片', () => {
  const result = pairFiles(['x.png', 'x.jpg', 'A.png', 'readme.txt'].map(n => file(n)), [file('a.png')]);
  assert.equal(result.pairs.length, 0);
  assert.equal(result.missingCount, 4);
  assert.equal(result.ambiguousCount, 2);
  assert.equal(result.issues.filter(i => i.name === 'x').length, 2);
});

test('根目录仅索引 hazy 和 clear 直属图片，不读取深层目录', () => {
  const files = ['root/hazy/1.png', 'root/clear/1.jpg', 'root/hazy/deep/2.png', 'root/other/3.png', 'root/clear/note.txt'].map(path => file(path.split('/').at(-1)!, path));
  const result = readRoot(files);
  assert.deepEqual(result.hazy.map(f => f.name), ['1.png']);
  assert.deepEqual(result.clear.map(f => f.name), ['1.jpg']);
});

test('任意两个直属图片子文件夹也可以作为两层配对', () => {
  const files = ['before/1.png', 'before/2.png', 'after/1.jpg', 'after/2.jpg'].map(path => file(path.split('/').at(-1)!, `dataset/${path}`));
  const result = readRoot(files);
  assert.deepEqual(result.names, { hazy: 'after', clear: 'before' });
  assert.equal(result.hazy.length, 2);
  assert.equal(result.clear.length, 2);
});

test('单侧文件夹只读取直属图片，支持大批量索引', () => {
  assert.deepEqual(readFolder([file('1.png', 'chosen/1.png'), file('2.png', 'chosen/nested/2.png')]).map(f => f.name), ['1.png']);
  const h = Array.from({ length: 5000 }, (_, i) => file(`${5000 - i}.png`));
  const c = h.map(f => file(f.name.replace('.png', '.jpg'))).reverse();
  const result = pairFiles(h, c);
  assert.equal(result.pairs.length, 5000);
  assert.equal(result.pairs[0].name, '1');
  assert.equal(result.pairs.at(-1)!.name, '5000');
});

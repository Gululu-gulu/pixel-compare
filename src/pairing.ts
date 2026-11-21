export type ImageFile = Pick<File, 'name' | 'webkitRelativePath'>;
export type Pair<T = File> = { name: string; hazy: T; clear: T };
export type Issue = { name: string; kind: 'missing' | 'ambiguous'; detail: string; count: number };
export type Pairing<T> = { pairs: Pair<T>[]; issues: Issue[]; missingCount: number; ambiguousCount: number };

const extensions = /\.(png|jpe?g|webp)$/i;
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'variant' });
export const isImage = (file: Pick<File, 'name'>) => extensions.test(file.name);
export const stem = (name: string) => name.replace(extensions, '');
const pathParts = (file: ImageFile) => file.webkitRelativePath.split('/').filter(Boolean);

export function readRoot<T extends ImageFile>(files: readonly T[]) {
  // Only root/<side>/file; deeper files never join the index. The familiar
  // hazy/clear names are preferred, but any dataset with exactly two image
  // subfolders is also accepted (before/after, input/output, ref/result...).
  const direct = files.filter(f => pathParts(f).length === 3 && isImage(f));
  const folders = [...new Set(direct.map(f => pathParts(f)[1]))];
  const named = folders.includes('hazy') && folders.includes('clear') ? ['hazy', 'clear'] : folders.length === 2 ? [...folders].sort((a, b) => collator.compare(a, b)) : [];
  return {
    hazy: direct.filter(f => pathParts(f)[1] === named[0]),
    clear: direct.filter(f => pathParts(f)[1] === named[1]),
    names: { hazy: named[0] ?? '', clear: named[1] ?? '' },
  };
}

export function readFolder<T extends ImageFile>(files: readonly T[]) {
  return files.filter(f => pathParts(f).length === 2 && isImage(f));
}

export function pairFiles<T extends Pick<File, 'name'>>(hazy: readonly T[], clear: readonly T[]): Pairing<T> {
  const index = (files: readonly T[]) => {
    const map = new Map<string, T[]>();
    for (const file of files) {
      if (!isImage(file)) continue;
      const key = stem(file.name);
      map.set(key, [...(map.get(key) ?? []), file]);
    }
    return map;
  };
  const h = index(hazy), c = index(clear);
  const names = [...new Set([...h.keys(), ...c.keys()])].sort((a, b) => collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0));
  const result: Pairing<T> = { pairs: [], issues: [], missingCount: 0, ambiguousCount: 0 };
  for (const name of names) {
    const hs = h.get(name) ?? [], cs = c.get(name) ?? [];
    if (hs.length > 1 || cs.length > 1) {
      const sides = [hs.length > 1 ? `hazy：${hs.map(f => f.name).join('、')}` : '', cs.length > 1 ? `clear：${cs.map(f => f.name).join('、')}` : ''].filter(Boolean);
      const count = (hs.length > 1 ? hs.length : 0) + (cs.length > 1 ? cs.length : 0);
      result.issues.push({ name, kind: 'ambiguous', detail: `同名文件存在歧义（${sides.join('；')}），已跳过此组。${!hs.length ? '同时缺少 hazy 图。' : !cs.length ? '同时缺少 clear 图。' : ''}`, count });
      result.ambiguousCount += count;
    }
    if (!hs.length || !cs.length) {
      const count = hs.length + cs.length;
      result.issues.push({ name, kind: 'missing', detail: `缺少 ${!hs.length ? 'hazy 有雾图' : 'clear 清晰图'}；现有文件：${[...hs, ...cs].map(f => f.name).join('、')}`, count });
      result.missingCount += count;
    }
    if (hs.length === 1 && cs.length === 1) result.pairs.push({ name, hazy: hs[0], clear: cs[0] });
  }
  return result;
}

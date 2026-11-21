import { isImage, stem } from './pairing.ts';

export function planUpdates<T extends Pick<File, 'name'>>(names: readonly string[], files: readonly T[]) {
  const known = new Set(names), groups = new Map<string, T[]>();
  const skipped: string[] = [];
  for (const file of files) {
    if (!isImage(file)) { skipped.push(`${file.name}：不支持的格式`); continue; }
    const name = stem(file.name);
    groups.set(name, [...(groups.get(name) ?? []), file]);
  }
  const updates = new Map<string, T>();
  for (const [name, candidates] of groups) {
    if (candidates.length > 1) skipped.push(`${name}：选择了多个同名文件，已跳过`);
    else if (!known.has(name)) skipped.push(`${candidates[0].name}：没有对应的现有配对`);
    else updates.set(name, candidates[0]);
  }
  return { updates, skipped };
}

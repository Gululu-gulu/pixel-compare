export type Side = 'hazy' | 'clear';
export type Transform = { x: number; y: number; scale: number; rotation: number };
export type Alignment = Record<Side, Transform>;
export type History = { past: Alignment[]; present: Alignment; future: Alignment[] };
export const IDENTITY: Transform = { x: 0, y: 0, scale: 1, rotation: 0 };
export const ORIGINAL: Alignment = { hazy: IDENTITY, clear: IDENTITY };
export const EMPTY_HISTORY: History = { past: [], present: ORIGINAL, future: [] };
export const isOriginal = (t: Transform) => t.x === 0 && t.y === 0 && t.scale === 1 && t.rotation === 0;
export const isAdjusted = (a: Alignment) => !isOriginal(a.hazy) || !isOriginal(a.clear);
export const equalTransform = (a: Transform, b: Transform) => a.x === b.x && a.y === b.y && a.scale === b.scale && a.rotation === b.rotation;
export const equalAlignment = (a: Alignment, b: Alignment) => equalTransform(a.hazy, b.hazy) && equalTransform(a.clear, b.clear);
export function commit(history: History, value: Alignment): History {
  return equalAlignment(history.present, value) ? history : { past: [...history.past, history.present].slice(-100), present: value, future: [] };
}
export function undo(history: History): History {
  return !history.past.length ? history : { past: history.past.slice(0, -1), present: history.past.at(-1)!, future: [history.present, ...history.future] };
}
export function redo(history: History): History {
  return !history.future.length ? history : { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}
export function normalizeTransform(value: Transform): Transform {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return { x: round(Math.max(-1e6, Math.min(1e6, value.x))), y: round(Math.max(-1e6, Math.min(1e6, value.y))), scale: round(Math.max(.01, Math.min(100, value.scale))), rotation: round(Math.max(-360, Math.min(360, value.rotation))) };
}

// Geometry is in original-image pixels. Scale and rotation pivot at image center;
// translation is applied last, in the common untransformed reference grid.
export function matrix(t: Transform, width: number, height: number): [number, number, number, number, number, number] {
  const radians = t.rotation * Math.PI / 180;
  const a = t.scale * Math.cos(radians), b = t.scale * Math.sin(radians), cx = width / 2, cy = height / 2;
  return [a, b, -b, a, t.x + cx - a * cx + b * cy, t.y + cy - b * cx - a * cy];
}
export function drawAligned(ctx: CanvasRenderingContext2D, image: HTMLImageElement, t: Transform) {
  ctx.save();
  if (!isOriginal(t)) {
    // Keep the original image extent as the output frame, matching PNG export.
    ctx.beginPath(); ctx.rect(0, 0, image.naturalWidth, image.naturalHeight); ctx.clip();
    ctx.transform(...matrix(t, image.naturalWidth, image.naturalHeight));
  }
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}
export async function alignedPNG(image: HTMLImageElement, t: Transform, smooth: boolean): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建导出画布，请关闭其他大图片后重试。');
  try {
    ctx.imageSmoothingEnabled = smooth;
    drawAligned(ctx, image, t);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('导出失败，图片可能超出浏览器内存限制。')), 'image/png'));
  } finally { canvas.width = 1; canvas.height = 1; }
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseAdjustments(text: string): Map<string, Alignment> {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('pairs' in data) || !Array.isArray(data.pairs)) throw new Error('参数文件格式不正确，需要 version: 1 和 pairs 列表。');
  const result = new Map<string, Alignment>();
  const transform = (value: unknown): Transform => {
    if (!value || typeof value !== 'object') throw new Error('缺少图层调整参数。');
    const t = value as Record<string, unknown>;
    for (const key of ['x', 'y', 'scale', 'rotation']) if (typeof t[key] !== 'number' || !Number.isFinite(t[key])) throw new Error(`调整参数 ${key} 必须是有限数值。`);
    const cleaned = { x: t.x as number, y: t.y as number, scale: t.scale as number, rotation: t.rotation as number };
    if (!equalTransform(cleaned, normalizeTransform(cleaned))) throw new Error('参数超出范围：位移 ±1000000 px，缩放 1%～10000%，旋转 ±360°，最多 6 位小数。');
    return cleaned;
  };
  for (const pair of data.pairs) {
    if (!pair || typeof pair !== 'object' || typeof pair.name !== 'string' || result.has(pair.name)) throw new Error('配对名称缺失或重复，未应用任何参数。');
    result.set(pair.name, { hazy: transform(pair.hazy), clear: transform(pair.clear) });
  }
  return result;
}

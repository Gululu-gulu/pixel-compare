import type { Pair } from './pairing';

export type LoadedPair = { pair: Pair; hazy: HTMLImageElement; clear: HTMLImageElement };
export type ImageStatus = { kind: 'ok' | 'mismatch' | 'error'; hazySize?: string; clearSize?: string; message?: string };
export const dimensions = (img: HTMLImageElement) => `${img.naturalWidth} × ${img.naturalHeight}`;

// One disposable load owns exactly two URLs, even on decode error or cancellation.
export function loadImages(pair: Pair) {
  const urls = [URL.createObjectURL(pair.hazy), URL.createObjectURL(pair.clear)];
  const images = urls.map(url => { const img = new Image(); img.src = url; return img; });
  const promise = Promise.allSettled(images.map(img => img.decode())).then(results => {
    const failures = results.flatMap((r, i) => r.status === 'rejected' || !images[i].naturalWidth ? [`${i === 0 ? 'hazy' : 'clear'}：${i === 0 ? pair.hazy.name : pair.clear.name}`] : []);
    if (failures.length) throw new Error(`图片解码失败（${failures.join('；')}）。文件可能损坏或格式不受支持，可继续查看其他组。`);
    return { pair, hazy: images[0], clear: images[1] };
  });
  return { promise, dispose: () => { images.forEach(img => img.removeAttribute('src')); urls.forEach(url => URL.revokeObjectURL(url)); } };
}

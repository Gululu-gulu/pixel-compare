import type { LoadedPair } from './images';
import { ORIGINAL, drawAligned, equalAlignment, normalizeTransform, type Alignment, type Side, type Transform } from './alignment';

export type Mode = 'wipe' | 'overlay' | 'blink';
export type Options = { mode: Mode; opacity: number; smooth: boolean; crosshair: boolean; blinkClear: boolean; alignment: Alignment; editSide: Side | null };
const editable = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable="true"]');
export const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

// Both images share one viewport transform. Optional per-image adjustments are
// explicit, stored separately, and never changed by moving the divider.
export class ComparisonEngine {
  private images: LoadedPair | null = null;
  private options: Options = { mode: 'wipe', opacity: .5, smooth: true, crosshair: false, blinkClear: false, alignment: ORIGINAL, editSide: null };
  private width = 0;
  private height = 0;
  private scale = 1;
  private x = 0;
  private y = 0;
  private split = .5;
  private isFit = true;
  private frame = 0;
  private dpr = 1;
  private pointer: { x: number; y: number } | null = null;
  private drag: { id: number; kind: 'pan' | 'split' | 'adjust'; x: number; y: number; startX: number; startY: number; side: Side | null; original: Alignment } | null = null;
  private space = false;
  private observer: ResizeObserver;
  private cleanup: (() => void)[] = [];
  private ctx: CanvasRenderingContext2D;
  private layers = [document.createElement('canvas'), document.createElement('canvas')];
  private layersDirty = true;

  constructor(private stage: HTMLDivElement, private canvas: HTMLCanvasElement, private divider: HTMLDivElement, private coords: HTMLSpanElement, private onScale: (scale: number) => void, private onAdjust: (side: Side, value: Transform) => void) {
    this.ctx = canvas.getContext('2d')!;
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(stage);
    this.listen(stage, 'wheel', this.wheel, { passive: false });
    this.listen(stage, 'pointerdown', this.down);
    this.listen(stage, 'pointermove', this.move);
    this.listen(stage, 'pointerup', this.up);
    this.listen(stage, 'pointercancel', this.up);
    this.listen(stage, 'lostpointercapture', this.up);
    this.listen(stage, 'pointerleave', this.leave);
    this.listen(window, 'keydown', this.keydown);
    this.listen(window, 'keyup', this.keyup);
    this.listen(window, 'blur', this.blur);
    this.listen(window, 'resize', this.resize);
    this.listen(divider, 'keydown', this.dividerKey);
    this.resize();
  }

  private listen(target: EventTarget, type: string, handler: EventListenerOrEventListenerObject, options?: AddEventListenerOptions) {
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  setImages(images: LoadedPair | null, preserveView = false) {
    this.images = images;
    this.layersDirty = true;
    if (!images) this.layers.forEach(layer => { layer.width = 1; layer.height = 1; });
    this.pointer = null;
    if (this.drag?.kind === 'adjust') this.options.alignment = this.drag.original;
    this.drag = null;
    this.updateCursor();
    if (images && (!preserveView || this.isFit)) this.fit();
    else if (images) { this.onScale(this.scale); this.schedule(); }
    else { this.coords.textContent = 'X —  /  Y —'; this.schedule(); }
  }

  setOptions(options: Options) { if (options.smooth !== this.options.smooth || !equalAlignment(options.alignment, this.options.alignment)) this.layersDirty = true; this.options = options; this.schedule(); }

  private resize = () => {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    const dx = (w - this.width) / 2, dy = (h - this.height) / 2;
    this.width = w; this.height = h;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.layersDirty = true;
    if (this.isFit) this.fit();
    else { this.x += dx; this.y += dy; this.schedule(); }
  };

  fit = () => {
    this.isFit = true;
    this.layersDirty = true;
    if (this.images && this.width && this.height) {
      const { naturalWidth: w, naturalHeight: h } = this.images.hazy;
      this.scale = Math.max(.001, Math.min(Math.max(1, this.width - 72) / w, Math.max(1, this.height - 64) / h));
      this.x = (this.width - w * this.scale) / 2;
      this.y = (this.height - h * this.scale) / 2;
      this.onScale(this.scale);
    }
    this.schedule();
  };

  actual = () => {
    if (!this.images) return;
    this.isFit = false; this.scale = 1;
    this.layersDirty = true;
    // Integer CSS positions make 100% mapping easy to inspect.
    this.x = Math.round((this.width - this.images.hazy.naturalWidth) / 2);
    this.y = Math.round((this.height - this.images.hazy.naturalHeight) / 2);
    this.onScale(1); this.schedule();
  };

  zoom = (factor: number, px = this.width / 2, py = this.height / 2) => {
    if (!this.images) return;
    const next = clamp(this.scale * factor, .001, 64), ratio = next / this.scale;
    this.x = px - (px - this.x) * ratio;
    this.y = py - (py - this.y) * ratio;
    this.scale = next; this.isFit = false;
    this.layersDirty = true;
    this.onScale(next); this.schedule();
  };

  reset = () => { this.split = .5; this.fit(); };
  private local(event: PointerEvent | WheelEvent) { const rect = this.stage.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  private wheel: EventListener = raw => {
    const event = raw as WheelEvent;
    if (!this.images) return;
    event.preventDefault();
    const p = this.local(event);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
    this.zoom(Math.exp(-clamp(delta, -200, 200) * .0025), p.x, p.y);
    this.pointer = p;
  };
  private down: EventListener = raw => {
    const event = raw as PointerEvent;
    if (event.target instanceof Element && event.target.closest('[data-alignment-panel]')) return;
    if (!this.images || event.button !== 0 || !event.isPrimary || this.drag) return;
    const p = this.local(event);
    const isDivider = event.target instanceof Element && !!event.target.closest('[data-divider]');
    const kind = this.space ? 'pan' : isDivider && this.options.mode === 'wipe' ? 'split' : this.options.editSide ? 'adjust' : null;
    if (!kind) return;
    event.preventDefault();
    this.drag = { id: event.pointerId, kind, ...p, startX: p.x, startY: p.y, side: this.options.editSide, original: this.options.alignment };
    this.stage.setPointerCapture(event.pointerId);
    this.updateCursor();
  };
  private move: EventListener = raw => {
    const event = raw as PointerEvent, p = this.local(event);
    this.pointer = p;
    if (this.drag && this.drag.id === event.pointerId) {
      if (this.drag.kind === 'split') this.split = clamp(p.x / this.width, 0, 1);
      else if (this.drag.kind === 'adjust' && this.drag.side) {
        const side = this.drag.side, t = this.drag.original[side];
        this.options.alignment = { ...this.options.alignment, [side]: normalizeTransform({ ...t, x: t.x + (p.x - this.drag.startX) / this.scale, y: t.y + (p.y - this.drag.startY) / this.scale }) };
        this.layersDirty = true;
      }
      else { this.x += p.x - this.drag.x; this.y += p.y - this.drag.y; this.isFit = false; this.layersDirty = true; }
      this.drag.x = p.x; this.drag.y = p.y;
    }
    this.schedule();
  };
  private up: EventListener = raw => {
    const event = raw as PointerEvent;
    if (this.drag?.id !== event.pointerId) return;
    const drag = this.drag;
    this.drag = null;
    if (drag.kind === 'adjust' && drag.side) {
      if (event.type === 'pointerup') this.onAdjust(drag.side, this.options.alignment[drag.side]);
      else { this.options.alignment = drag.original; this.layersDirty = true; }
    }
    if (this.stage.hasPointerCapture(event.pointerId)) this.stage.releasePointerCapture(event.pointerId);
    this.pointer = null;
    this.updateCursor(); this.schedule();
  };
  private leave: EventListener = () => { if (!this.drag) { this.pointer = null; this.schedule(); } };
  private keydown: EventListener = raw => {
    const event = raw as KeyboardEvent;
    const buttonFocused = event.target instanceof HTMLElement && !!event.target.closest('button');
    if (event.code === 'Space' && !editable(event.target) && (!buttonFocused || this.stage.matches(':hover')) && this.images && !document.querySelector('dialog[open]')) {
      event.preventDefault(); this.space = true; this.updateCursor();
    }
  };
  private keyup: EventListener = raw => { if ((raw as KeyboardEvent).code === 'Space') { this.space = false; this.updateCursor(); } };
  private blur = () => { this.space = false; if (this.drag?.kind === 'adjust') { this.options.alignment = this.drag.original; this.layersDirty = true; } this.drag = null; this.pointer = null; this.updateCursor(); this.schedule(); };
  private dividerKey: EventListener = raw => {
    const event = raw as KeyboardEvent;
    if (!this.images || this.options.mode !== 'wipe') return;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      this.split = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : clamp(this.split + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? .1 : .01), 0, 1);
      this.schedule();
    }
  };
  private updateCursor() { this.stage.style.cursor = this.drag?.kind === 'pan' || this.drag?.kind === 'adjust' ? 'grabbing' : this.space || this.options.editSide ? 'grab' : this.options.crosshair ? 'crosshair' : 'default'; }
  private schedule = () => { if (!this.frame) this.frame = requestAnimationFrame(this.draw); };
  private draw = () => {
    this.frame = 0;
    const ctx = this.ctx, w = this.width, h = this.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.divider.style.left = `${this.split * 100}%`;
    this.divider.setAttribute('aria-valuenow', String(Math.round(this.split * 100)));
    this.updateCursor();
    if (!this.images) { this.coords.textContent = 'X —  /  Y —'; return; }
    const { hazy, clear } = this.images;
    if (this.layersDirty) {
      this.layers.forEach((layer, index) => {
        layer.width = this.canvas.width; layer.height = this.canvas.height;
        const painter = layer.getContext('2d')!;
        painter.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, this.dpr * this.x, this.dpr * this.y);
        painter.imageSmoothingEnabled = this.options.smooth;
        drawAligned(painter, index === 0 ? hazy : clear, this.options.alignment[index === 0 ? 'hazy' : 'clear']);
      });
      this.layersDirty = false;
    }
    // Rasterize each image once per transform, then composite at native backing
    // pixels. Clipping a scaled image directly can change its sampling origin.
    const onlyClear = this.options.mode === 'blink' && this.options.blinkClear || this.options.mode === 'overlay' && this.options.opacity === 1;
    ctx.drawImage(this.layers[onlyClear ? 1 : 0], 0, 0);
    ctx.save();
    if (this.options.mode === 'wipe') {
      const edge = Math.round(this.canvas.width * this.split);
      ctx.beginPath(); ctx.rect(edge, 0, this.canvas.width - edge, this.canvas.height); ctx.clip();
      // Replace the visible region, so transparent pixels / image-edge coverage
      // are not composited twice when comparing an image against itself.
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(this.layers[1], 0, 0);
    }
    if (this.options.mode === 'overlay' && this.options.opacity > 0 && this.options.opacity < 1) { ctx.globalAlpha = this.options.opacity; ctx.drawImage(this.layers[1], 0, 0); }
    ctx.restore();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const p = this.pointer;
    const ix = p ? Math.floor((p.x - this.x) / this.scale) : -1, iy = p ? Math.floor((p.y - this.y) / this.scale) : -1;
    const valid = ix >= 0 && iy >= 0 && ix < hazy.naturalWidth && iy < hazy.naturalHeight;
    this.coords.textContent = valid ? `X ${ix}  /  Y ${iy}` : 'X —  /  Y —';
    if (p && valid && this.options.crosshair) {
      ctx.save();
      ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(0,0,0,.9)';
      ctx.beginPath(); ctx.moveTo(0, p.y + 1); ctx.lineTo(w, p.y + 1); ctx.moveTo(p.x + 1, 0); ctx.lineTo(p.x + 1, h); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(w, p.y); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, h); ctx.stroke();
      ctx.restore();
    }
  };
  dispose() { cancelAnimationFrame(this.frame); this.observer.disconnect(); this.cleanup.forEach(fn => fn()); this.images = null; this.layers.forEach(layer => { layer.width = 1; layer.height = 1; }); }
}

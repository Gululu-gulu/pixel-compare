import { useEffect, useRef, useState } from 'react';
import { Columns2, Layers2, ScanLine, Minus, Plus, Scan, RotateCcw, Maximize, Crosshair, Grid2X2, Pause, Play, MoveHorizontal, Image, FolderOpen, MousePointer2, SlidersHorizontal } from 'lucide-react';
import { ComparisonEngine, type Mode } from './engine';
import type { LoadedPair } from './images';
import { alignedPNG, download, isAdjusted, type History, type Side, type Transform } from './alignment';
import { AlignmentPanel } from './AlignmentPanel';

type Props = { images: LoadedPair | null; pairKey: string; pairName?: string; history: History; onAdjust: (side: Side, value: Transform) => void; onHistory: (action: 'undo' | 'redo' | 'reset') => void; onSaveParameters: () => void; onLoadParameters: () => void; state: 'empty' | 'loading' | 'ready' | 'error' | 'mismatch'; message?: string; onImport: () => void; onDemo: () => void; onError: (message: string) => void; demoLoading: boolean };

export function Viewer({ images, pairKey, pairName, history, onAdjust, onHistory, onSaveParameters, onLoadParameters, state, message, onImport, onDemo, onError, demoLoading }: Props) {
  const stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), divider = useRef<HTMLDivElement>(null), coords = useRef<HTMLSpanElement>(null);
  const engine = useRef<ComparisonEngine | null>(null);
  const [mode, setMode] = useState<Mode>('wipe');
  const [opacity, setOpacity] = useState(.5), [smooth, setSmooth] = useState(true), [crosshair, setCrosshair] = useState(false);
  const [scale, setScale] = useState(1), [interval, setIntervalValue] = useState(500), [playing, setPlaying] = useState(false), [blinkClear, setBlinkClear] = useState(false);
  const [editOpen, setEditOpen] = useState(false), [editSide, setEditSide] = useState<Side>('clear'), [dragEdit, setDragEdit] = useState(false), [exporting, setExporting] = useState(false);
  const previousPairKey = useRef<string | null>(null), adjustCallback = useRef(onAdjust);
  adjustCallback.current = onAdjust;
  const ready = state === 'ready' && !!images;

  useEffect(() => {
    const instance = new ComparisonEngine(stage.current!, canvas.current!, divider.current!, coords.current!, setScale, (side, value) => adjustCallback.current(side, value));
    engine.current = instance;
    return () => { instance.dispose(); engine.current = null; };
  }, []);
  useEffect(() => { engine.current?.setImages(images, previousPairKey.current === pairKey); if (images) previousPairKey.current = pairKey; }, [images, pairKey]);
  useEffect(() => { engine.current?.setOptions({ mode, opacity, smooth, crosshair, blinkClear, alignment: history.present, editSide: editOpen && dragEdit ? editSide : null }); }, [mode, opacity, smooth, crosshair, blinkClear, history.present, editSide, editOpen, dragEdit]);
  useEffect(() => { setBlinkClear(false); }, [mode, images]);
  useEffect(() => {
    if (mode !== 'blink' || !playing || !ready) return;
    const timer = window.setInterval(() => setBlinkClear(value => !value), interval);
    return () => window.clearInterval(timer);
  }, [mode, playing, interval, images, ready]);
  const changeMode = (next: Mode) => { setMode(next); if (next !== 'blink') setPlaying(false); };
  const exportPNG = async () => {
    if (!images || exporting) return;
    setExporting(true);
    try { download(await alignedPNG(images[editSide], history.present[editSide], smooth), `${pairName}.png`); }
    catch (error) { onError(error instanceof Error ? error.message : '导出图片失败。'); }
    finally { setExporting(false); }
  };
  const fullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { onError('无法进入全屏，请使用浏览器全屏快捷键 F11。'); }
  };

  return <section className="viewer">
    <div className="viewer-toolbar">
      <div className="segmented" aria-label="对比模式">
        <button aria-pressed={mode === 'wipe'} onClick={() => changeMode('wipe')}><Columns2 size={15} />滑动对比</button>
        <button aria-pressed={mode === 'overlay'} onClick={() => changeMode('overlay')}><Layers2 size={15} />透明叠加</button>
        <button aria-pressed={mode === 'blink'} onClick={() => changeMode('blink')}><ScanLine size={15} />交替闪烁</button>
      </div>
      <div className="view-controls">
        <button className="icon-button" disabled={!ready} aria-label="缩小" title="缩小" onClick={() => engine.current?.zoom(1 / 1.25)}><Minus size={16} /></button>
        <span className="zoom-value">{ready ? `${+(scale * 100).toFixed(1)}%` : '—'}</span>
        <button className="icon-button" disabled={!ready} aria-label="放大" title="放大" onClick={() => engine.current?.zoom(1.25)}><Plus size={16} /></button>
        <i className="separator" />
        <button disabled={!ready} onClick={() => engine.current?.fit()} title="完整显示图片，保持宽高比"><Scan size={15} /><span>适应</span></button>
        <button disabled={!ready} onClick={() => engine.current?.actual()} title="1 个原图像素 = 1 个 CSS 像素；高 DPI 屏幕的物理像素可能不同">100%</button>
        <button className="icon-button" disabled={!ready} aria-label="重置视图" title="重置视图与分割线" onClick={() => engine.current?.reset()}><RotateCcw size={15} /></button>
        <button className="icon-button" aria-label="全屏" title="全屏" onClick={fullscreen}><Maximize size={15} /></button>
      </div>
    </div>
    <div className="mode-options">
      <div className="mode-detail">
        {mode === 'wipe' && <><MoveHorizontal size={14} /><span>拖动分割线，观察同一位置的细节</span></>}
        {mode === 'overlay' && <><span>清晰图透明度</span><input aria-label="清晰图透明度" type="range" min="0" max="100" value={Math.round(opacity * 100)} onChange={e => setOpacity(+e.target.value / 100)} /><b>{Math.round(opacity * 100)}%</b></>}
        {mode === 'blink' && <><button className="small-button" disabled={!ready} onClick={() => setPlaying(p => !p)}>{playing ? <Pause size={13} /> : <Play size={13} />}{playing ? '暂停' : '开始'}</button><label>间隔 <select aria-label="闪烁间隔" value={interval} onChange={e => setIntervalValue(+e.target.value)}>{[100, 250, 500, 1000, 2000].map(n => <option key={n} value={n}>{n} ms</option>)}</select></label><span className="blink-indicator">当前：{blinkClear ? '清晰图' : '有雾图'}</span></>}
      </div>
      <div className="inspection-options">
        <button className={editOpen ? 'toggle on' : 'toggle'} aria-pressed={editOpen} disabled={!pairName} onClick={() => setEditOpen(v => !v)}><SlidersHorizontal size={14} /><span>手动对齐</span></button>
        <button className={crosshair ? 'toggle on' : 'toggle'} aria-pressed={crosshair} onClick={() => setCrosshair(v => !v)} title="辅助十字线"><Crosshair size={14} /><span>十字线</span></button>
        <button className={!smooth ? 'toggle on' : 'toggle'} aria-pressed={!smooth} onClick={() => setSmooth(v => !v)} title="开启后关闭平滑插值，使用最近邻显示"><Grid2X2 size={14} /><span>像素显示</span></button>
      </div>
    </div>
    <div className={`stage ${ready ? 'has-images' : ''}`} ref={stage} tabIndex={0} aria-label="图片对比画布，滚轮缩放，空格加拖动平移">
      <canvas ref={canvas} aria-label="有雾图和清晰图对比" />
      {ready && <div className="image-labels" aria-hidden="true">{mode === 'wipe' ? <><span><i />有雾图 <small>HAZY</small></span><span>清晰图 <small>CLEAR</small><i /></span></> : <span className="single-label">{mode === 'overlay' ? '透明度叠加' : blinkClear ? '清晰图 · CLEAR' : '有雾图 · HAZY'}</span>}</div>}
      {editOpen && pairName && <AlignmentPanel history={history} side={editSide} onSide={setEditSide} onChange={onAdjust} onHistory={onHistory} drag={dragEdit} onDrag={setDragEdit} onExport={exportPNG} exporting={exporting} ready={ready} onSaveParameters={onSaveParameters} onLoadParameters={onLoadParameters} />}
      {ready && isAdjusted(history.present) && <div className="adjustment-indicator">本组已应用手动对齐</div>}
      <div ref={divider} data-divider className="divider" style={{ display: ready && mode === 'wipe' ? undefined : 'none' }} role="slider" tabIndex={ready && mode === 'wipe' ? 0 : -1} aria-label="左右图像分割线" aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={50}>
        <div className="divider-line" /><div className="divider-handle"><MoveHorizontal size={22} /></div>
      </div>
      {state === 'empty' && <div className="empty-state">
        <div className="empty-illustration"><div className="ghost-card back"><Image size={38} /></div><div className="ghost-card front"><Image size={38} /><div className="mini-line"><MoveHorizontal size={14} /></div></div></div>
        <span className="eyebrow">EVERY PIXEL, SIDE BY SIDE</span>
        <h2>让每一个像素，都有迹可循</h2>
        <p>导入 hazy 与 clear 文件夹，自动配对同名图片。<br />拖动分割线，细看雾前雾后的每一处细节。</p>
        <button className="primary large" onClick={onImport}><FolderOpen size={17} />选择数据集目录</button>
        <button className="text-button demo-button" onClick={onDemo} disabled={demoLoading}>{demoLoading ? '正在加载示例…' : '先试试示例数据'}<span>↗</span></button>
        <div className="directory-example"><span>dataset /</span><b>hazy / 1.png</b><span>↔</span><b>clear / 1.png</b></div>
      </div>}
      {state === 'loading' && <div className="stage-message"><span className="spinner" /><h3>正在加载这一组图片</h3><p>两张图准备好后将一起显示</p></div>}
      {(state === 'error' || state === 'mismatch') && <div className="stage-message error-state"><ScanLine size={30} /><h3>{state === 'mismatch' ? '图片尺寸不同，无法直接进行像素级对比。' : '这组图片无法显示'}</h3><p>{message}</p><span>请在列表中选择其他组，或使用下方按钮继续浏览</span></div>}
      {ready && <div className="canvas-hint"><MousePointer2 size={12} />{editOpen && dragEdit ? `拖动${editSide === 'hazy' ? '有雾图' : '清晰图'}` : '滚轮缩放'}<span>·</span><kbd>Space</kbd> + 拖动平移</div>}
    </div>
    <div className="viewer-status"><span className={ready ? 'status-dot active' : 'status-dot'} /><span>{ready ? '共用坐标变换' : state === 'loading' ? '解码中' : '等待有效图片'}</span><span className="status-definition" title="高 DPI 屏幕的 CSS 像素与物理像素可能不同">100%：1 原图像素 = 1 CSS 像素</span><span className="coordinate" ref={coords}>X — / Y —</span></div>
  </section>;
}

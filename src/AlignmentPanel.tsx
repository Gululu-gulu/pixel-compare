import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Undo2, Redo2, RotateCcw, Download, Hand } from 'lucide-react';
import { IDENTITY, isOriginal, normalizeTransform, type History, type Side, type Transform } from './alignment';

type Props = { history: History; side: Side; onSide: (side: Side) => void; onChange: (side: Side, value: Transform) => void; onHistory: (action: 'undo' | 'redo' | 'reset') => void; drag: boolean; onDrag: (value: boolean) => void; onExport: () => void; exporting: boolean; ready: boolean; onSaveParameters: () => void; onLoadParameters: () => void };

function Numeric({ label, value, onChange, step, min, max, suffix }: { label: string; value: number; onChange: (n: number) => void; step: number; min: number; max: number; suffix: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label className="alignment-field"><span>{label}</span><div><input aria-label={label} type="number" min={min} max={max} step={step} value={draft} onChange={e => { const raw = e.target.value; setDraft(raw); if (raw !== '' && Number.isFinite(+raw) && +raw >= min && +raw <= max) onChange(+raw); }} onBlur={() => setDraft(String(value))} /><small>{suffix}</small></div></label>;
}

export function AlignmentPanel({ history, side, onSide, onChange, onHistory, drag, onDrag, onExport, exporting, ready, onSaveParameters, onLoadParameters }: Props) {
  const [step, setStep] = useState(1);
  const t = history.present[side];
  const patch = (value: Partial<Transform>) => onChange(side, normalizeTransform({ ...t, ...value }));
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!ready || !event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, [contenteditable="true"]')) return;
      const delta = event.shiftKey ? 10 : step;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        patch({ x: t.x + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0), y: t.y + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0) });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  return <div className="alignment-panel" data-alignment-panel>
    <div className="alignment-panel-header"><label>调整图层<select aria-label="调整图层" value={side} onChange={e => onSide(e.target.value as Side)}><option value="clear">清晰图 CLEAR</option><option value="hazy">有雾图 HAZY</option></select></label><span>{isOriginal(t) ? '当前图层未调整' : '已手动调整'}</span><div className="alignment-history"><button className="icon-button" disabled={!ready || !history.past.length} aria-label="撤销调整" title="撤销本组上一步" onClick={() => onHistory('undo')}><Undo2 size={15} /></button><button className="icon-button" disabled={!ready || !history.future.length} aria-label="重做调整" title="重做本组调整" onClick={() => onHistory('redo')}><Redo2 size={15} /></button><button disabled={!ready || isOriginal(t)} onClick={() => onChange(side, IDENTITY)} title="恢复当前图层，不影响另一层"><RotateCcw size={13} />重置此层</button></div></div>
    <fieldset disabled={!ready} className="alignment-fields">
      <Numeric label="水平位移" value={t.x} onChange={x => patch({ x })} step={.1} min={-1e6} max={1e6} suffix="px" />
      <Numeric label="垂直位移" value={t.y} onChange={y => patch({ y })} step={.1} min={-1e6} max={1e6} suffix="px" />
      <Numeric label="图层缩放" value={+(t.scale * 100).toFixed(4)} onChange={scale => patch({ scale: scale / 100 })} step={.01} min={1} max={10000} suffix="%" />
      <Numeric label="图层旋转" value={t.rotation} onChange={rotation => patch({ rotation })} step={.01} min={-360} max={360} suffix="°" />
    </fieldset>
    <div className="alignment-bottom"><div className="nudge-controls"><label>步长<select aria-label="微调步长" value={step} onChange={e => setStep(+e.target.value)}>{[.1, 1, 10].map(n => <option key={n} value={n}>{n} px</option>)}</select></label><button disabled={!ready} className="icon-button" aria-label="向左微调" onClick={() => patch({ x: t.x - step })}><ArrowLeft size={14} /></button><button disabled={!ready} className="icon-button" aria-label="向右微调" onClick={() => patch({ x: t.x + step })}><ArrowRight size={14} /></button><button disabled={!ready} className="icon-button" aria-label="向上微调" onClick={() => patch({ y: t.y - step })}><ArrowUp size={14} /></button><button disabled={!ready} className="icon-button" aria-label="向下微调" onClick={() => patch({ y: t.y + step })}><ArrowDown size={14} /></button></div><button className={`toggle ${drag ? 'on' : ''}`} disabled={!ready} aria-pressed={drag} onClick={() => onDrag(!drag)}><Hand size={13} />拖动此层</button><button className="export-aligned" disabled={!ready || exporting} onClick={onExport}><Download size={13} />{exporting ? '导出中…' : '导出此层 PNG'}</button></div>
    <p className="alignment-note">{ready ? '仅作用于当前组 · 位移以原图像素计 · Alt + 方向键微调 · 空格拖动仍平移视图' : '请先加载尺寸相同的两张图片，再进行微调。'}</p>
    <div className="parameter-actions"><button onClick={onSaveParameters}>保存全部调整参数</button><button onClick={onLoadParameters}>载入调整参数</button></div>
  </div>;
}

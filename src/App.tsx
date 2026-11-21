import { useEffect, useMemo, useRef, useState } from 'react';
import { Aperture, FolderOpen, Folder, ShieldCheck, PanelLeftClose, PanelLeftOpen, Search, ChevronLeft, ChevronRight, ChevronDown, Image, Check, AlertTriangle, X, CircleHelp, ArrowUpRight, Files, RefreshCw, RotateCcw, Pencil } from 'lucide-react';
import { pairFiles, readRoot, readFolder, isImage, type Pair, type Issue } from './pairing';
import { loadImages, dimensions, type ImageStatus, type LoadedPair } from './images';
import { Viewer } from './Viewer';
import { EMPTY_HISTORY, ORIGINAL, IDENTITY, commit, undo, redo, isAdjusted, normalizeTransform, download, parseAdjustments, type History, type Side, type Transform } from './alignment';
import { planUpdates } from './updates';

type Result = { pair: Pair; loaded: LoadedPair | null; status: ImageStatus };

function PairList({ pairs, selected, onSelect, statuses, search, datasetKey, edited }: { pairs: Pair[]; selected: number; onSelect: (index: number) => void; statuses: Record<string, ImageStatus>; search: string; datasetKey: number; edited: Set<string> }) {
  const scroll = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0), [height, setHeight] = useState(600);
  const filtered = useMemo(() => pairs.map((pair, index) => ({ pair, index })).filter(({ pair }) => pair.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())), [pairs, search]);
  const rowHeight = 66;
  useEffect(() => { const el = scroll.current!; const ro = new ResizeObserver(() => setHeight(el.clientHeight)); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = 0; setTop(0); }, [search, datasetKey]);
  useEffect(() => {
    const position = filtered.findIndex(item => item.index === selected);
    const el = scroll.current;
    if (position < 0 || !el) return;
    if (position * rowHeight < el.scrollTop) el.scrollTop = position * rowHeight;
    else if ((position + 1) * rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = (position + 1) * rowHeight - el.clientHeight;
  }, [selected, filtered]);
  const start = Math.max(0, Math.floor(top / rowHeight) - 4), end = Math.min(filtered.length, Math.ceil((top + height) / rowHeight) + 4);
  return <div className="pair-list" ref={scroll} onScroll={e => setTop(e.currentTarget.scrollTop)} aria-label="图片配对列表">
    {!filtered.length && <div className="list-empty"><Files size={24} /><p>{pairs.length ? '没有匹配的图片' : '导入后，配对图片将显示在这里'}</p></div>}
    <div style={{ height: filtered.length * rowHeight, position: 'relative' }}>
      {filtered.slice(start, end).map(({ pair, index }, i) => {
        const status = statuses[pair.name];
        return <button key={pair.name} style={{ position: 'absolute', top: (start + i) * rowHeight, height: rowHeight - 6, left: 0, right: 0 }} className={`pair-row ${selected === index ? 'selected' : ''}`} onClick={() => onSelect(index)} aria-current={selected === index ? 'true' : undefined} title={`${pair.hazy.name} ↔ ${pair.clear.name}${status?.message ? `\n${status.message}` : ''}`}>
          <span className="pair-symbol"><Image size={18} /></span>
          <span className="pair-text"><b>{pair.name}</b><small>{status?.kind === 'error' ? '图片加载失败' : status?.kind === 'mismatch' ? '尺寸不一致' : status?.hazySize ?? '尚未检查尺寸'}</small></span>
          {status && status.kind !== 'ok' ? <AlertTriangle className="warning-icon" size={14} /> : edited.has(pair.name) ? <Pencil size={13} className="green" aria-label="已替换或调整" /> : selected === index ? <span className="row-dot" /> : status?.kind === 'ok' ? <Check size={13} className="muted" /> : <span className="row-number">{String(index + 1).padStart(2, '0')}</span>}
        </button>;
      })}
    </div>
  </div>;
}

function Issues({ issues }: { issues: Issue[] }) {
  const [query, setQuery] = useState(''), [page, setPage] = useState(0);
  const filtered = issues.filter(issue => `${issue.name} ${issue.detail}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / 40));
  return <><p className="dialog-intro">以下文件未进入有效配对。重复名称不会被自动挑选；同一名称可能同时存在歧义和缺失问题。</p><input className="dialog-search" aria-label="搜索导入问题" placeholder="搜索文件名或问题…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /><div className="issues-list">{filtered.slice(page * 40, (page + 1) * 40).map((issue, i) => <div className="issue" key={`${issue.kind}-${issue.name}-${i}`}><AlertTriangle size={16} /><div><b>{issue.name}<small>{issue.kind === 'missing' ? '缺少配对' : '名称歧义'}</small></b><p>{issue.detail}</p></div></div>)}{!filtered.length && <p className="muted">没有匹配的问题。</p>}</div><div className="issues-pagination"><span>{filtered.length} 条问题 · {page + 1} / {pages} 页</span><button disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</button><button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>下一页</button></div></>;
}

export function App() {
  const rootInput = useRef<HTMLInputElement>(null), hazyInput = useRef<HTMLInputElement>(null), clearInput = useRef<HTMLInputElement>(null);
  const singleInput = useRef<HTMLInputElement>(null), batchInput = useRef<HTMLInputElement>(null), parametersInput = useRef<HTMLInputElement>(null);
  const pendingUpdate = useRef<{ side: Side; name?: string; generation: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [hazy, setHazy] = useState<File[]>([]), [clear, setClear] = useState<File[]>([]);
  const [folderNames, setFolderNames] = useState({ hazy: '', clear: '' });
  const [selected, setSelected] = useState(0), [search, setSearch] = useState(''), [collapsed, setCollapsed] = useState(false);
  const [notice, setNotice] = useState(''), [dialogKind, setDialogKind] = useState<'help' | 'issues'>('help');
  const [result, setResult] = useState<Result | null>(null), [statuses, setStatuses] = useState<Record<string, ImageStatus>>({});
  const [demoLoading, setDemoLoading] = useState(false), [demo, setDemo] = useState(false);
  const generation = useRef(0);
  const [overrides, setOverrides] = useState<Map<string, Partial<Record<Side, File>>>>(() => new Map());
  const [histories, setHistories] = useState<Map<string, History>>(() => new Map());
  const pairing = useMemo(() => pairFiles(hazy, clear), [hazy, clear]);
  const pairs = pairing.pairs, basePair = pairs[selected], override = basePair ? overrides.get(basePair.name) : undefined;
  const pair = useMemo(() => basePair ? { ...basePair, ...override } : undefined, [basePair, override]);
  const displayPairs = useMemo(() => pairs.map(p => overrides.has(p.name) ? { ...p, ...overrides.get(p.name) } : p), [pairs, overrides]);
  const history = basePair ? histories.get(basePair.name) ?? EMPTY_HISTORY : EMPTY_HISTORY;
  const editedNames = useMemo(() => new Set([...overrides.keys(), ...[...histories].filter(([, h]) => isAdjusted(h.present)).map(([name]) => name)]), [overrides, histories]);
  const current = result?.pair === pair ? result : null;
  const readyImages = current?.status.kind === 'ok' ? current.loaded : null;
  const state = !pair ? 'empty' : !current ? 'loading' : current.status.kind === 'ok' ? 'ready' : current.status.kind;
  const openDialog = (kind: 'help' | 'issues') => { setDialogKind(kind); dialog.current?.showModal(); };
  const select = (index: number) => { setSelected(Math.max(0, Math.min(pairs.length - 1, index))); };

  useEffect(() => {
    if (!pair) { setResult(null); return; }
    let active = true;
    const task = loadImages(pair);
    task.promise.then(loaded => {
      if (!active) return;
      const same = loaded.hazy.naturalWidth === loaded.clear.naturalWidth && loaded.hazy.naturalHeight === loaded.clear.naturalHeight;
      const status: ImageStatus = { kind: same ? 'ok' : 'mismatch', hazySize: dimensions(loaded.hazy), clearSize: dimensions(loaded.clear), message: same ? undefined : `有雾图：${dimensions(loaded.hazy)}；清晰图：${dimensions(loaded.clear)}。已停止此组对比，未拉伸或裁剪图片。` };
      setResult({ pair, loaded: same ? loaded : null, status });
      setStatuses(previous => ({ ...previous, [pair.name]: status }));
    }).catch((error: unknown) => {
      if (!active) return;
      const status: ImageStatus = { kind: 'error', message: error instanceof Error ? error.message : '读取图片失败，请重新选择文件夹。' };
      setResult({ pair, loaded: null, status });
      setStatuses(previous => ({ ...previous, [pair.name]: status }));
    });
    return () => { active = false; task.dispose(); };
  }, [pair]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || dialog.current?.open) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"], [role="slider"]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSelected(index => Math.max(0, Math.min(pairs.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [pairs.length]);

  const resetIndex = () => { generation.current++; setSelected(0); setSearch(''); setStatuses({}); setNotice(''); setDemo(false); setOverrides(new Map()); setHistories(new Map()); };
  const adjust = (side: Side, value: Transform) => {
    if (!basePair) return;
    setHistories(previous => {
      const next = new Map(previous), old = previous.get(basePair.name) ?? EMPTY_HISTORY;
      next.set(basePair.name, commit(old, { ...old.present, [side]: normalizeTransform(value) }));
      return next;
    });
  };
  const changeHistory = (action: 'undo' | 'redo' | 'reset') => {
    if (!basePair) return;
    setHistories(previous => {
      const next = new Map(previous), old = previous.get(basePair.name) ?? EMPTY_HISTORY;
      next.set(basePair.name, action === 'undo' ? undo(old) : action === 'redo' ? redo(old) : commit(old, ORIGINAL));
      return next;
    });
  };
  const clearChangedState = (names: string[], side: Side) => {
    setStatuses(previous => { const next = { ...previous }; names.forEach(name => delete next[name]); return next; });
    setHistories(previous => {
      const next = new Map(previous);
      names.forEach(name => { const old = next.get(name); if (old) next.set(name, { past: [], present: { ...old.present, [side]: IDENTITY }, future: [] }); });
      return next;
    });
  };
  const openUpdate = (side: Side, single: boolean) => {
    if (!basePair && single) return;
    pendingUpdate.current = { side, name: single ? basePair?.name : undefined, generation: generation.current };
    (single ? singleInput : batchInput).current?.click();
  };
  const applyUpdates = (files: File[], single: boolean) => {
    if (!files.length) return;
    const pending = pendingUpdate.current;
    if (!pending || pending.generation !== generation.current) { setNotice('数据集已更换，请重新选择要更新的图片。'); return; }
    let updates: Map<string, File>, skipped: string[] = [];
    if (single) {
      if (!pending.name || !isImage(files[0])) { setNotice('请选择 PNG、JPEG 或 WebP 图片。'); return; }
      updates = new Map([[pending.name, files[0]]]);
    } else {
      ({ updates, skipped } = planUpdates(pairs.map(p => p.name), files));
    }
    const side = pending.side;
    setOverrides(previous => { const next = new Map(previous); for (const [name, file] of updates) next.set(name, { ...next.get(name), [side]: file }); return next; });
    clearChangedState([...updates.keys()], side);
    setNotice(`已更新 ${updates.size} 张${side === 'hazy' ? '有雾图' : '清晰图'}，保留当前组和查看位置。更新侧的手动调整已重置。${skipped.length ? ` 跳过 ${skipped.length} 项：${skipped.join('；')}` : ''}`);
  };
  const restoreOriginal = (side: Side) => {
    if (!basePair) return;
    const name = basePair.name;
    setOverrides(previous => { const next = new Map(previous), entry = { ...next.get(name) }; delete entry[side]; if (!entry.hazy && !entry.clear) next.delete(name); else next.set(name, entry); return next; });
    clearChangedState([name], side);
    setNotice(`已恢复第 ${name} 组最初导入的${side === 'hazy' ? '有雾图' : '清晰图'}。`);
  };
  const saveParameters = () => {
    const values = [...histories].filter(([, h]) => isAdjusted(h.present)).map(([name, h]) => ({ name, ...h.present }));
    download(new Blob([JSON.stringify({ version: 1, pairs: values }, null, 2)], { type: 'application/json' }), 'haze-compare-adjustments.json');
    setNotice(`已导出 ${values.length} 组调整参数。重新导入原始数据集后，可载入此文件继续调整。`);
  };
  const loadParameters = async (file?: File) => {
    if (!file) return;
    const epoch = generation.current;
    try {
      const incoming = parseAdjustments(await file.text());
      if (epoch !== generation.current) { setNotice('数据集已更换，请重新载入调整参数。'); return; }
      const known = new Set(pairs.map(p => p.name)), matched = [...incoming].filter(([name]) => known.has(name));
      setHistories(previous => { const next = new Map(previous); for (const [name, value] of matched) next.set(name, commit(next.get(name) ?? EMPTY_HISTORY, value)); return next; });
      setNotice(`已载入 ${matched.length} 组调整参数，跳过 ${incoming.size - matched.length} 个未匹配名称。仅应用到同名配对，请确认使用的是对应的原图。`);
    } catch (error) { setNotice(`载入失败：${error instanceof Error ? error.message : '无法读取参数文件'}，未修改任何调整。`); }
  };
  const importRoot = (files: File[]) => {
    if (!files.length) return;
    const found = readRoot(files);
    if (!found.hazy.length && !found.clear.length) { setNotice('没有找到可读取的图片。请选择包含两个图片子文件夹的数据集目录（例如 hazy/clear、before/after 或 input/output），仅支持直属的 PNG、JPEG、WebP 图片。'); return; }
    resetIndex(); setHazy(found.hazy); setClear(found.clear);
    setFolderNames({ hazy: found.names.hazy, clear: found.names.clear });
    if (!found.hazy.length || !found.clear.length) setNotice('目录中需要两个直属图片子文件夹，请检查目录结构，或单独补选两侧文件夹。');
  };
  const importSide = (side: 'hazy' | 'clear', files: File[]) => {
    if (!files.length) return;
    const images = readFolder(files);
    if (!images.length) { setNotice('所选文件夹中没有直属的 PNG、JPEG、WebP 图片，未读取更深层子目录。'); return; }
    resetIndex();
    if (side === 'hazy') setHazy(images); else setClear(images);
    setFolderNames(names => ({ ...names, [side]: files[0].webkitRelativePath.split('/')[0] }));
  };
  const loadDemo = async () => {
    if (demoLoading) return;
    const request = ++generation.current;
    setDemoLoading(true); setNotice('');
    try {
      const files = await Promise.all(['hazy', 'clear'].flatMap(side => ['1', '2', '10'].map(async name => {
        const response = await fetch(`${import.meta.env.BASE_URL}demo/${side}/${name}.png`);
        if (!response.ok) throw new Error('示例资源读取失败');
        const file = new File([await response.blob()], `${name}.png`, { type: 'image/png' });
        Object.defineProperty(file, 'webkitRelativePath', { value: `demo/${side}/${name}.png` });
        return file;
      })));
      if (generation.current !== request) return;
      const data = readRoot(files);
      setHazy(data.hazy); setClear(data.clear); setSelected(0); setSearch(''); setStatuses({}); setOverrides(new Map()); setHistories(new Map()); setFolderNames({ hazy: '示例 / hazy', clear: '示例 / clear' }); setDemo(true);
    } catch { if (generation.current === request) setNotice('无法读取本地示例，请检查服务是否运行，或直接导入自己的数据集。'); }
    finally { setDemoLoading(false); }
  };
  const input = (ref: typeof rootInput, onFiles: (files: File[]) => void, label: string) => <input ref={ref} type="file" className="file-input" aria-label={label} {...{ webkitdirectory: '', directory: '' }} multiple onChange={e => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />;

  return <div className="app-shell">
    {input(rootInput, importRoot, '选择数据集根目录')}{input(hazyInput, files => importSide('hazy', files), '选择 hazy 文件夹')}{input(clearInput, files => importSide('clear', files), '选择 clear 文件夹')}
    <input className="file-input" ref={singleInput} type="file" accept=".png,.jpg,.jpeg,.webp" aria-label="替换当前图片文件" onChange={e => { applyUpdates(Array.from(e.target.files ?? []), true); e.target.value = ''; }} />
    <input className="file-input" ref={batchInput} type="file" multiple accept=".png,.jpg,.jpeg,.webp" aria-label="批量更新图片文件" onChange={e => { applyUpdates(Array.from(e.target.files ?? []), false); e.target.value = ''; }} />
    <input className="file-input" ref={parametersInput} type="file" accept=".json" aria-label="载入调整参数文件" onChange={e => { void loadParameters(e.target.files?.[0]); e.target.value = ''; }} />
    <header className="app-header">
      <div className="brand"><div className="brand-mark"><Aperture size={23} strokeWidth={1.8} /></div><div><h1>像素镜<span> / </span><small>双图对比</small></h1><p>PIXEL COMPARE</p></div></div>
      <div className="header-actions"><span className="local-badge"><ShieldCheck size={14} />本地处理 · 无需上传</span><button className="help-button" onClick={() => openDialog('help')}><CircleHelp size={16} /><span>使用指南</span></button><button className="primary" onClick={() => rootInput.current?.click()}><FolderOpen size={16} />导入数据集<ArrowUpRight size={14} /></button></div>
    </header>
    {notice && <div className="notice" role="alert"><AlertTriangle size={16} /><span>{notice}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
    <div className="workspace">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-heading">{!collapsed && <><span>数据集</span><small>DATASET</small></>}<button className="icon-button" title={collapsed ? '展开侧栏' : '收起侧栏'} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setCollapsed(v => !v)}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button></div>
        {!collapsed && <>
          <div className="folder-inputs"><button onClick={() => hazyInput.current?.click()} title="选择有雾图片文件夹"><span className="folder-icon hazy"><Folder size={17} /></span><span><b>{folderNames.hazy || 'hazy'}</b><small>{hazy.length ? `${hazy.length} 张图片` : '选择有雾图文件夹'}</small></span>{hazy.length ? <Check size={14} className="green" /> : <PlusSmall />}</button><button onClick={() => clearInput.current?.click()} title="选择清晰图片文件夹"><span className="folder-icon clear"><Folder size={17} /></span><span><b>{folderNames.clear || 'clear'}</b><small>{clear.length ? `${clear.length} 张图片` : '选择清晰图文件夹'}</small></span>{clear.length ? <Check size={14} className="green" /> : <PlusSmall />}</button></div>
          <div className="dataset-stats"><div><strong>{pairs.length}</strong><span>已配对组</span></div><button disabled={!pairing.missingCount} onClick={() => openDialog('issues')}><strong className={pairing.missingCount ? 'amber' : ''}>{pairing.missingCount}</strong><span>未配对文件</span></button><button disabled={!pairing.ambiguousCount} onClick={() => openDialog('issues')}><strong className={pairing.ambiguousCount ? 'amber' : ''}>{pairing.ambiguousCount}</strong><span>歧义文件</span></button></div>
          {!!pairing.issues.length && <button className="issue-link" onClick={() => openDialog('issues')}><AlertTriangle size={13} />查看导入问题<ChevronRight size={14} /></button>}
          {!pairs.length && !!(hazy.length || clear.length) && <p className="no-pairs" role="status">{!hazy.length || !clear.length ? '请继续选择另一侧文件夹以建立配对。' : '没有有效配对，请检查文件名或查看导入问题。'}</p>}
          <div className="list-heading"><span>图片配对 <small>{pairs.length}</small></span><span className="sort-label">自然排序<ChevronDown size={12} /></span></div>
          <label className="search-box"><Search size={15} /><input aria-label="搜索配对图片" value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索图片名称…" />{search && <button className="icon-button" aria-label="清空搜索" onClick={() => setSearch('')}><X size={12} /></button>}</label>
          <PairList pairs={displayPairs} selected={selected} onSelect={select} statuses={statuses} search={search} datasetKey={generation.current} edited={editedNames} />
          <div className="sidebar-footer"><span className="status-dot active" />{demo ? '示例数据 · 3 组' : pairs.length ? '数据集已就绪' : '等待导入数据集'}<span>v1.1</span></div>
        </>}
      </aside>
      <main className="main-content">
        <div className="content-heading"><div><div className="eyebrow">IMAGE COMPARISON</div><h2>图像对比<span className="heading-divider" />{pair ? <span className="current-name">{pair.name}</span> : <span className="muted current-name">工作台</span>}</h2></div><div className="heading-actions"><details className="update-menu"><summary><RefreshCw size={13} />批量更新<ChevronDown size={12} /></summary><div><p>选择修改过的图片，按文件名更新已有配对。</p><button disabled={!pairs.length} onClick={e => { openUpdate('hazy', false); e.currentTarget.closest('details')?.removeAttribute('open'); }}>批量更新有雾图</button><button disabled={!pairs.length} onClick={e => { openUpdate('clear', false); e.currentTarget.closest('details')?.removeAttribute('open'); }}>批量更新清晰图</button><small>保留当前组。未匹配或重名文件会跳过。</small></div></details><span className="alignment-badge"><span className="status-dot active" />像素对齐检查</span></div></div>
        <Viewer images={readyImages} pairKey={`${generation.current}:${basePair?.name ?? ''}`} pairName={basePair?.name} history={history} onAdjust={adjust} onHistory={changeHistory} onSaveParameters={saveParameters} onLoadParameters={() => parametersInput.current?.click()} state={state} message={current?.status.message} onImport={() => rootInput.current?.click()} onDemo={loadDemo} onError={setNotice} demoLoading={demoLoading} />
        <div className="navigation-bar"><div className="file-details">{pair ? (['hazy', 'clear'] as const).map(side => <span className="file-detail" key={side}><span className={`type-tag ${side === 'clear' ? 'clear-tag' : ''}`}>{side.toUpperCase()}</span><b title={pair[side].name}>{pair[side].name}</b><small>{side === 'hazy' ? current?.status.hazySize ?? '—' : current?.status.clearSize ?? '—'}</small><button className="replace-button" aria-label={`替换当前${side === 'hazy' ? '有雾图' : '清晰图'}`} onClick={() => openUpdate(side, true)}><RefreshCw size={10} />替换</button>{override?.[side] && <button className="restore-button" aria-label={`恢复原始${side === 'hazy' ? '有雾图' : '清晰图'}`} title="恢复最初导入的文件" onClick={() => restoreOriginal(side)}><RotateCcw size={10} /></button>}</span>) : <span className="muted"><Image size={15} />选择文件夹，开始你的第一次对比</span>}</div><div className="navigation-controls"><button className="nav-button" disabled={!pair || selected === 0} onClick={() => select(selected - 1)} aria-label="上一组"><ChevronLeft size={16} /><span>上一组</span></button><span className="progress">{pair ? <><b>{selected + 1}</b><span> / </span>{pairs.length}</> : '— / —'}</span><button className="nav-button" disabled={!pair || selected === pairs.length - 1} onClick={() => select(selected + 1)} aria-label="下一组"><span>下一组</span><ChevronRight size={16} /></button></div></div>
        {demo && <div className="demo-note"><span>示例说明</span>1：雾图与清晰图对齐；2：清晰图向右偏移 3 像素；10：两层为同一张图。<button onClick={() => rootInput.current?.click()}>导入自己的数据<ArrowUpRight size={12} /></button></div>}
      </main>
    </div>
    <footer className="app-footer"><span>像素镜 <i>·</i> 每一个细节，清晰可见</span><span>PNG / JPEG / WebP <i>·</i> 原始像素，原始比例</span></footer>
    <dialog ref={dialog} className="app-dialog" onClick={e => { if (e.target === dialog.current) dialog.current.close(); }}>
      <div className="dialog-heading"><div><span className="eyebrow">{dialogKind === 'help' ? 'QUICK GUIDE' : 'IMPORT REPORT'}</span><h2>{dialogKind === 'help' ? '开始一次精准对比' : '导入问题'}</h2></div><button className="icon-button" aria-label="关闭对话框" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      {dialogKind === 'issues' ? <Issues key={pairing.issues.map(i => `${i.kind}:${i.name}`).join('|')} issues={pairing.issues} /> : <div className="help-content"><section><b>01 / 导入目录</b><p>选择直接包含 hazy 和 clear 的根目录，或在侧栏分别选择两个文件夹。仅读取直属的 PNG、JPEG、WebP 图片。</p><pre>dataset/\n  hazy/1.png\n  clear/1.png</pre></section><section><b>02 / 自动配对</b><p>按不含扩展名的文件名精确匹配，区分大小写。例如 1.jpg 与 1.png 可以配对。缺失和重名文件会单独列出，不自动修改或配准图片。</p></section><section><b>03 / 检查对齐</b><p>拖动分割线查看边缘是否连续；用透明叠加检查重影，用交替闪烁检查轮廓跳动。开启“像素显示”可关闭平滑插值。</p></section><section><b>快捷操作</b><div className="shortcut-row"><span>缩放</span><kbd>鼠标滚轮</kbd></div><div className="shortcut-row"><span>平移</span><kbd>空格 + 拖动</kbd></div><div className="shortcut-row"><span>切换图片组（画布获得焦点时）</span><kbd>← / →</kbd></div><div className="shortcut-row"><span>分割线获得焦点时微调</span><kbd>← / → · Home / End</kbd></div></section><p className="help-footnote"><ShieldCheck size={15} />图片保留在本地浏览器内存中，刷新后需要重新选择文件夹。100% 表示 1 原图像素对应 1 CSS 像素；高 DPI 屏幕的物理像素可能不同。</p></div>}
    </dialog>
  </div>;
}

function PlusSmall() { return <span className="folder-plus">+</span>; }

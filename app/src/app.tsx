import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { parseGraph, serializeGraph, finishNode, LIMITS, RELEASE, length, normalize, truncate, type Graph, type GraphNode, type Field } from './model.ts';
import { FileSession, FileReadError, readSnapshot, type FileHandle, type Snapshot } from './file-session.ts';
import { prepareHandle, recall } from './handles.ts';
import { resumeFile } from './resume-file.ts';
import './style.css';
import 'katex/dist/katex.min.css';

declare global {
  interface Window {
    showOpenFilePicker?: (options: unknown) => Promise<FileHandle[]>;
    FileSystemObserver?: new (callback: (records: { type: string }[]) => void) => {
      observe(handle: FileHandle): Promise<void>; disconnect(): void;
    };
  }
}
const bootSource = '<!doctype html>\n' + document.documentElement.outerHTML;
const initialBase = location.href;
const host = document.createElement('main');
host.id = 'mindmap-editor';
document.body.append(host);
document.querySelectorAll('section.map').forEach(el => el.setAttribute('hidden', ''));
const log = (event: string, details: object = {}) => console.info('[mindmap]', JSON.stringify({ event, at: new Date().toISOString(), release: RELEASE, ...details }));
const imageWarning = '图片无法显示：此处应有一张图片，但资源已失效或无法加载。';
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const errorDetails = (error: unknown) => error instanceof FileReadError
  ? { message: error.message, originalName: error.originalName, phase: error.phase, permission: error.permission, cause: errorText(error.cause) }
  : { message: errorText(error) };

function ImagePreview({ src, alt }: { src?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed || !src ? <span className="image-warning">{imageWarning}</span> : <img src={src} alt={alt ?? ''} onError={() => setFailed(true)} />;
}
function Preview({ source, hideImages, base }: { source: string; hideImages: boolean; base: string | null }) {
  return <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}
    components={{ img: ({ src, alt }) => {
      if (hideImages) return null;
      let resolved: string | undefined;
      try { resolved = /^(https?:|data:image\/)/i.test(src ?? '') ? src : base ? new URL(src ?? '', base).href : undefined; } catch { /* Fixed failure preview. */ }
      return <ImagePreview src={resolved} alt={alt} />;
    } }}>{source}</Markdown>;
}

type Draft = Pick<GraphNode, Field>;
type Undo = { id: string; field: Field; previous: string };
function App({ liveHandle, sessionBase, reload }: { liveHandle: FileHandle | null; sessionBase: string | null; reload: (handle: FileHandle, base: string | null) => void }) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [version, redraw] = useState(0);
  const [view, setView] = useState({ scale: 1, x: 160, y: 140 });
  const state = React.useRef({ graph: null as Graph | null, draft: null as Draft | null, focus: null as string | null,
    history: [] as Undo[], deleted: new Set<string>(), session: null as FileSession | null,
    stopWatch: () => {}, base: sessionBase, busy: false, switching: 0, alive: true });
  const render = () => redraw(n => n + 1);
  const warn = (message: string) => setWarnings(existing => [...existing.filter(m => m !== message), message]);
  const discard = () => {
    state.current.draft = null; state.current.focus = null; state.current.history = [];
    state.current.deleted.clear(); setFocus(null); setExpanded(new Set());
  };
  const forceRefresh = (handle: FileHandle, reason: string) => {
    if (!state.current.alive) return;
    log('refresh', { reason });
    state.current.stopWatch(); state.current.session?.stop(); discard();
    state.current.alive = false; state.current.graph = null; setGraph(null);
    // Remount the complete editor session. Only the capability survives, never its data.
    // Navigating file:// then restoring a serialized handle can lose its browser grant.
    reload(handle, state.current.base);
  };
  const applySource = (source: string, base: string | null): Graph => {
    const parsed = parseGraph(source);
    if (!parsed.graph) throw new Error(parsed.diagnostics.map(d => d.message).join(' '));
    const model = parsed.graph;
    // Switching resources across releases is not implemented in this first file milestone.
    if (model.resources.scripts.some(url => !url.endsWith(`/runtime/${RELEASE}/app.js`) && !url.endsWith(`runtime/${RELEASE}/app.js`))) {
      throw new Error('此图引用其他运行资源版本，当前版本尚不能安全切换。原图未替换。');
    }
    discard(); state.current.graph = model; state.current.base = base;
    // Fixed outer bounds in this milestone: deterministic load-time collision avoidance.
    const accepted: GraphNode[] = [];
    for (const node of model.nodes) {
      while (accepted.some(other => Math.abs(other.x - node.x) < 380 && Math.abs(other.y - node.y) < 320)) node.x += 400;
      accepted.push(node);
    }
    setWarnings(parsed.diagnostics.map(d => `${d.object} · ${d.field}：${d.message}`)); setGraph(model);
    const box = host.getBoundingClientRect();
    const minX = Math.min(0, ...model.nodes.map(n => n.x)), minY = Math.min(0, ...model.nodes.map(n => n.y));
    const maxX = Math.max(0, ...model.nodes.map(n => n.x + 360)), maxY = Math.max(0, ...model.nodes.map(n => n.y + 300));
    const scale = model.nodes.length ? Math.min(1, Math.max(1, box.width - 180) / Math.max(1, maxX - minX), Math.max(1, box.height - 160) / Math.max(1, maxY - minY)) : 1;
    setView({ scale, x: (box.width + 80 - (maxX + minX) * scale) / 2, y: (box.height + 80 - (maxY + minY) * scale) / 2 });
    log('loaded', { nodes: model.nodes.length, edges: model.nodes.reduce((n, node) => n + node.edges.length, 0), warnings: parsed.diagnostics.length });
    return model;
  };
  const attach = async (handle: FileHandle, snapshot: Snapshot) => {
    state.current.stopWatch(); state.current.session?.stop();
    const session = new FileSession(handle, snapshot, reason => forceRefresh(handle, reason), error => {
      if (session.invalidated) { discard(); state.current.graph = null; setGraph(null); }
      warn(errorText(error)); log('file-error', errorDetails(error));
    });
    state.current.session = session;
    const interval = setInterval(() => void session.check(), 500);
    const onFocus = () => void session.check(); window.addEventListener('focus', onFocus);
    let observer: InstanceType<NonNullable<Window['FileSystemObserver']>> | null = null;
    let watching = true;
    state.current.stopWatch = () => { watching = false; clearInterval(interval); observer?.disconnect(); window.removeEventListener('focus', onFocus); };
    if (window.FileSystemObserver) {
      try {
        observer = new window.FileSystemObserver(records => { if (records.length) void session.check(true); });
        await observer.observe(handle);
        if (!watching) { observer.disconnect(); return; }
        log('watching', { observer: true, polling: true });
      } catch (error) { observer?.disconnect(); if (watching) log('watching', { observer: false, polling: true, reason: errorText(error) }); }
    } else log('watching', { observer: false, polling: true });
    await session.check();
  };
  useEffect(() => {
    let disposed = false;
    const mayInitialize = () => !disposed && state.current.alive && !state.current.graph;
    void (async () => {
      try {
        const current = await resumeFile(liveHandle, recall);
        if (!mayInitialize()) return;
        if (current) {
          applySource(current.snapshot.source, liveHandle ? sessionBase : null);
          await attach(current.handle, current.snapshot);
        } else {
          applySource(bootSource, initialBase);
          warn('请使用“打开其他图”选择图文件，授予读取、保存及外部修改检测所需的文件权限。');
        }
      } catch (error) { if (mayInitialize()) { warn(errorText(error)); log('startup-error', errorDetails(error)); } }
    })();
    return () => { disposed = true; state.current.stopWatch(); state.current.session?.stop(); };
  }, []);
  const finish = () => {
    const s = state.current;
    if (s.graph && s.focus && s.draft) {
      if (!finishNode(s.graph, s.focus, s.draft)) { s.deleted.add(s.focus); s.history = s.history.filter(h => h.id !== s.focus); }
    }
    s.draft = null; s.focus = null; setFocus(null); render();
  };
  const select = (node: GraphNode) => {
    if (state.current.focus === node.id) return;
    finish(); state.current.focus = node.id;
    state.current.draft = { title: node.title, card: node.card, notes: node.notes }; setFocus(node.id);
  };
  const edit = (id: string, field: Field, next: string) => {
    const draft = state.current.draft;
    if (!draft || state.current.focus !== id) return;
    next = normalize(next);
    if (length(next) > LIMITS[field]) { render(); return; }
    if (draft[field] !== next) state.current.history.push({ id, field, previous: draft[field] });
    draft[field] = next;
    // Empty title remains a draft; valid fields update the effective in-memory model.
    const node = state.current.graph?.nodes.find(n => n.id === id);
    if (node && (field !== 'title' || next.trim())) node[field] = next;
    render();
  };
  const open = async () => {
    if (!window.showOpenFilePicker) { warn('当前宿主不提供文件选择能力。'); return; }
    const token = ++state.current.switching;
    let prepared: Awaited<ReturnType<typeof prepareHandle>> | undefined;
    try {
      const [handle] = await window.showOpenFilePicker({ multiple: false, types: [{ description: 'MindMap HTML', accept: { 'text/html': ['.html'] } }] });
      const snapshot = await readSnapshot(handle);
      if (!state.current.alive || token !== state.current.switching) return;
      const candidate = parseGraph(snapshot.source);
      if (!candidate.graph) throw new Error('无法识别此图，当前图保持不变。');
      if (candidate.graph.resources.scripts.some(url => !url.endsWith(`runtime/${RELEASE}/app.js`))) throw new Error('目标图的运行资源版本尚不受当前版本支持，当前图保持不变。');
      // Prepare durable storage without changing what an old-file refresh will restore.
      prepared = await prepareHandle(handle);
      if (!state.current.alive || token !== state.current.switching) return;
      prepared.commit();
      state.current.stopWatch(); state.current.session?.stop();
      applySource(snapshot.source, null); await attach(handle, snapshot);
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') warn(errorText(error));
      log('open-failed', errorDetails(error));
    } finally {
      await prepared?.discard().catch(error => log('capability-cleanup-error', { message: errorText(error) }));
    }
  };
  const save = async () => {
    if (state.current.busy || !state.current.graph) return;
    const session = state.current.session;
    if (!session) { warn('尚未获得当前图的文件句柄，请使用“打开其他图”选择要编辑的文件。'); return; }
    // Request permission while the click / keyboard user activation is still live.
    const permission = session.handle.requestPermission({ mode: 'readwrite' });
    state.current.busy = true;
    try { finish(); await session.save(serializeGraph(state.current.graph), permission); }
    catch (error) { warn(errorText(error)); }
    finally { state.current.busy = false; }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); if (event.shiftKey) return;
        const s = state.current;
        let item: Undo | undefined;
        while ((item = s.history.pop())) {
          const node = s.graph?.nodes.find(n => n.id === item!.id);
          if (!node || s.deleted.has(item.id)) continue;
          if (s.focus !== node.id) { finish(); select(node); }
          if (s.draft) s.draft[item.field] = item.previous;
          if (item.field !== 'title' || item.previous.trim()) node[item.field] = item.previous;
          render(); break;
        }
      }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  const nodeById = new Map(graph?.nodes.map(n => [n.id, n]));
  return <>
    <nav className="toolbar" aria-label="文件操作">
      <button aria-label="打开其他图" onClick={() => void open()}>▱</button>
      <button aria-label="保存" onClick={() => void save()} disabled={!graph}>▣</button>
    </nav>
    <aside className="warnings" aria-label="警告栏" role="status">{warnings.length ? warnings.map((w, i) => <div key={i}>{w}</div>) : '暂无警告'}</aside>
    <section className="canvas" aria-label="图画布" onPointerDown={event => { if (event.target === event.currentTarget) finish(); }}
      style={{ backgroundSize: `${24 * view.scale}px ${24 * view.scale}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
      <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <svg className="edges" aria-label="图连线"><defs><marker id="mm-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#627ba5" /></marker></defs>
          {graph?.nodes.flatMap(n => n.edges.map(e => {
            const target = nodeById.get(e.target); if (!target) return null;
            const x1 = n.x + 360, y1 = n.y + 150, x2 = target.x, y2 = target.y + 150;
            const path = e.kind === 'straight' ? `M${x1},${y1} L${x2},${y2}` : e.kind === 'orthogonal' ? `M${x1},${y1} H${(x1 + x2) / 2} V${y2} H${x2}` : `M${x1},${y1} C${x1 + 80},${y1} ${x2 - 80},${y2} ${x2},${y2}`;
            return <path key={e.id} d={path} fill="none" stroke="#627ba5" strokeWidth="2" markerEnd="url(#mm-arrow)" />;
          }))}
        </svg>
        {graph?.nodes.map(node => {
          const isExpanded = expanded.has(node.id), editing = focus === node.id;
          const draft = editing ? state.current.draft : null;
          return <article key={node.id} data-node-id={node.id} className={`node ${editing ? 'focused' : ''} ${isExpanded ? 'expanded' : ''}`}
            aria-label={`节点 ${node.id}`} style={{ left: node.x, top: node.y }} onClick={() => select(node)}>
            <button className="expand" aria-label={isExpanded ? '收起节点' : '展开节点'} onClick={event => { event.stopPropagation(); setExpanded(old => { const next = new Set(old); next.has(node.id) ? next.delete(node.id) : next.add(node.id); return next; }); }}>↕</button>
            {(['title', 'card', ...(isExpanded ? ['notes'] : [])] as Field[]).map(field => <div key={field} className={`field ${field}`}>
              {editing && draft ? <textarea aria-label={`${node.id} ${field}`} value={draft[field]}
                onChange={event => edit(node.id, field, event.target.value)}
                onPaste={event => {
                  event.preventDefault(); const input = event.currentTarget;
                  const before = input.value.slice(0, input.selectionStart), after = input.value.slice(input.selectionEnd);
                  const pasted = truncate(event.clipboardData.getData('text/plain'), LIMITS[field] - length(before + after));
                  edit(node.id, field, before + pasted + after);
                  requestAnimationFrame(() => input.setSelectionRange(before.length + pasted.length, before.length + pasted.length));
                }} /> : <Preview source={node[field]} hideImages={field === 'title' && !isExpanded} base={state.current.base} />}
            </div>)}
          </article>;
        })}
      </div>
    </section>
  </>;
}
function FileHost() {
  const [session, setSession] = useState({ epoch: 0, handle: null as FileHandle | null, base: initialBase as string | null });
  return <App key={session.epoch} liveHandle={session.handle} sessionBase={session.base}
    reload={(handle, base) => setSession(previous => ({ epoch: previous.epoch + 1, handle, base }))} />;
}
createRoot(host).render(<FileHost />);

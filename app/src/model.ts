import { parse, type DefaultTreeAdapterMap } from 'parse5';

type Element = DefaultTreeAdapterMap['element'];
type TreeNode = DefaultTreeAdapterMap['node'];
export const FORMAT = 'mindmap/1';
export const RELEASE = '1.0.0-alpha.2';
export const LIMITS = { title: 1024, card: 1024, notes: 32768, label: 1024 } as const;
export type Field = 'title' | 'card' | 'notes';
export type Point = [number, number];
export type Shape = 'round-rect' | 'rect' | 'diamond' | 'parallelogram' | 'circle';
export interface Edge { id: string; target: string; label: string; kind: 'bezier' | 'orthogonal' | 'straight'; start?: Point; end?: Point }
export interface GraphNode { id: string; classes: string[]; shape: Shape; x: number; y: number; title: string; card: string; notes: string; edges: Edge[] }
export interface Graph { lang: string; title: string; classes: string[]; nodes: GraphNode[]; resources: { css: string[]; scripts: string[] } }
export interface Diagnostic { object: string; field: string; message: string }
export interface Parsed { graph: Graph | null; diagnostics: Diagnostic[] }
export const normalize = (s: string) => s.replace(/\r\n?/g, '\n');
export const length = (s: string) => Array.from(normalize(s)).length;
export const truncate = (s: string, max: number) => Array.from(normalize(s)).slice(0, max).join('');
export const blank = (s: string) => s.trim().length === 0;
const shapes: Shape[] = ['round-rect', 'rect', 'diamond', 'parallelogram', 'circle'];
const element = (n: TreeNode): n is Element => 'tagName' in n;
const children = (n: TreeNode): TreeNode[] => 'childNodes' in n ? n.childNodes : [];
const elements = (n: TreeNode): Element[] => children(n).filter(element);
const attr = (n: Element, name: string) => n.attrs.find(a => a.name === name)?.value;
const classes = (n: Element) => (attr(n, 'class') ?? '').split(/\s+/).filter(Boolean);
const text = (n: TreeNode): string => n.nodeName === '#text' ? (n as DefaultTreeAdapterMap['textNode']).value : children(n).map(text).join('');
const all = (n: TreeNode): Element[] => elements(n).flatMap(e => [e, ...all(e)]);
const validId = (id: string | undefined): id is string => Boolean(id && !/\s/.test(id));
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A single parser shared by the browser and the read-only validator. No DOM execution. */
export function parseGraph(source: string, repair = true): Parsed {
  const diagnostics: Diagnostic[] = [];
  const warn = (object: string, field: string, message: string) => diagnostics.push({ object, field, message });
  const doc = parse(source, { sourceCodeLocationInfo: true, onParseError: e => warn(`行 ${e.startLine}`, 'HTML', e.code) });
  const tags = all(doc);
  const format = tags.filter(e => e.tagName === 'meta' && attr(e, 'name') === 'format');
  const maps = tags.filter(e => e.tagName === 'section' && classes(e).includes('map'));
  if (format.length !== 1 || attr(format[0], 'content') !== FORMAT || maps.length !== 1) {
    warn('文档', 'format', '需要唯一的 mindmap/1 格式标识和 section.map，未将无法识别的文件当作空图。');
    return { graph: null, diagnostics };
  }
  const map = maps[0];
  const graph: Graph = {
    lang: attr(tags.find(e => e.tagName === 'html')!, 'lang') ?? 'zh-CN',
    title: text(tags.find(e => e.tagName === 'title') ?? doc),
    classes: classes(map), nodes: [],
    resources: {
      css: tags.filter(e => e.tagName === 'link' && attr(e, 'rel') === 'stylesheet').map(e => attr(e, 'href') ?? ''),
      scripts: tags.filter(e => e.tagName === 'script' && attr(e, 'src')).map(e => attr(e, 'src')!),
    },
  };
  if (!tags.some(e => e.tagName === 'title')) graph.title = 'MindMap';
  const articles = elements(map).filter(e => e.tagName === 'article');
  const seen = new Set<string>();
  const retained = articles.filter((n, i) => {
    const id = attr(n, 'id');
    if (!validId(id)) { warn(`节点 ${i + 1}`, 'id', '标识为空或包含空白，排除此节点。'); return false; }
    if (seen.has(id)) { warn(id, 'id', '重复节点标识，仅保留第一次出现的节点。'); return false; }
    seen.add(id); return true;
  });
  const discarded = new Set(articles.filter(n => !retained.includes(n)).flatMap(n => [n, ...all(n)]));
  const idCounts = new Map<string, number>();
  for (const el of tags) if (!discarded.has(el) && attr(el, 'id')) idCounts.set(attr(el, 'id')!, (idCounts.get(attr(el, 'id')!) ?? 0) + 1);
  const readText = (el: Element, field: keyof typeof LIMITS, object: string): string | null => {
    if (elements(el).length) { warn(object, field, '文本字段包含未转义的 HTML 元素，排除此字段内容。'); return null; }
    const value = normalize(text(el));
    if (length(value) > LIMITS[field]) warn(object, field, `${length(value)} 个码点，超过 ${LIMITS[field]}；${repair ? '载入时截断' : '原始内容不合规'}。`);
    return repair ? truncate(value, LIMITS[field]) : value;
  };
  for (const article of retained) {
    const id = attr(article, 'id')!;
    if ((idCounts.get(id) ?? 0) !== 1) { warn(id, 'id', '与其他文档元素冲突，排除此节点。'); continue; }
    const direct = elements(article);
    const fields = ['title', 'card', 'notes', 'links'].map(c => direct.filter(e => classes(e).includes(c)));
    const fieldTags = ['h2', 'div', 'div', 'ul'];
    if (fields.some((f, i) => f.length !== 1 || f[0].tagName !== fieldTags[i]) || !article.sourceCodeLocation?.endTag) {
      warn(id, '结构', '节点必须完整包含 title、card、notes 和 links，排除此节点。'); continue;
    }
    const [title, card, notes] = fields.slice(0, 3).map((f, i) => readText(f[0], ['title', 'card', 'notes'][i] as Field, id));
    if (title === null || blank(title)) { warn(id, 'title', '源文件标题为空或无效，排除此节点。'); continue; }
    const shapeTokens = classes(article).filter(c => shapes.includes(c as Shape));
    const shape = shapeTokens.length === 1 ? shapeTokens[0] as Shape : 'round-rect';
    if (shapeTokens.length > 1) warn(id, 'shape', '形态冲突，使用圆角矩形。');
    let x = Number(attr(article, 'data-x')), y = Number(attr(article, 'data-y'));
    if (attr(article, 'data-x') === undefined || attr(article, 'data-y') === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
      warn(id, 'position', '位置缺失或无效，生成半径 5 内的候选。');
      const angle = Math.random() * 2 * Math.PI, radius = Math.sqrt(Math.random()) * 5;
      x = Math.cos(angle) * radius; y = Math.sin(angle) * radius;
    }
    const node: GraphNode = { id, title, card: card ?? '', notes: notes ?? '', x, y, shape, classes: classes(article).filter(c => !shapes.includes(c as Shape)), edges: [] };
    for (const li of elements(fields[3][0])) {
      const anchors = elements(li);
      const a = anchors[0];
      if (li.tagName !== 'li' || anchors.length !== 1 || a.tagName !== 'a') { warn(id, 'links', '边必须是 li 内唯一的 a，排除此条目。'); continue; }
      const edgeId = attr(a, 'id');
      if (!validId(edgeId) || idCounts.get(edgeId) !== 1) { warn(id, 'links.id', '边标识无效或冲突，排除此边。'); continue; }
      const href = attr(a, 'href') ?? '';
      let target = '';
      try { if (href.startsWith('#')) target = decodeURIComponent(href.slice(1)); } catch { /* Diagnostic below. */ }
      if (!target) { warn(edgeId, 'href', '目标必须是本图的有效片段标识。'); continue; }
      const label = readText(a, 'label', edgeId);
      const kinds = classes(a).filter(c => ['bezier', 'orthogonal', 'straight'].includes(c));
      const edge: Edge = { id: edgeId, target, label: label ?? '', kind: kinds.length === 1 ? kinds[0] as Edge['kind'] : 'bezier' };
      for (const end of ['start', 'end'] as const) {
        const raw = attr(a, `data-${end}`);
        if (raw === undefined) continue;
        const values = raw.trim().split(/\s+/).map(Number);
        if (values.length === 2 && values.every(n => Number.isFinite(n) && n >= 0 && n <= 1)) edge[end] = values as Point;
        else warn(edgeId, end, '连接点需要两个 0–1 内有限数，排除无效属性。');
      }
      node.edges.push(edge);
    }
    graph.nodes.push(node);
  }
  const ids = new Set(graph.nodes.map(n => n.id));
  for (const node of graph.nodes) node.edges = node.edges.filter(e => {
    if (ids.has(e.target)) return true;
    warn(e.id, 'target', '目标不存在或已排除，移除此边。'); return false;
  });
  return { graph, diagnostics };
}

export function serializeGraph(graph: Graph): string {
  const rows = graph.nodes.map(n => {
    if (blank(n.title)) throw new Error(`节点 ${n.id} 标题为空`);
    for (const field of ['title', 'card', 'notes'] as const) if (length(n[field]) > LIMITS[field]) throw new Error(`节点 ${n.id} ${field} 超限`);
    const links = n.edges.map(e => `        <li><a id="${esc(e.id)}" href="#${esc(encodeURIComponent(e.target))}" class="${e.kind}"${e.start ? ` data-start="${e.start.join(' ')}"` : ''}${e.end ? ` data-end="${e.end.join(' ')}"` : ''}>${esc(e.label)}</a></li>`).join('\n');
    return `    <article id="${esc(n.id)}" class="${esc([...n.classes, n.shape].join(' '))}" data-x="${n.x}" data-y="${n.y}">\n      <h2 class="title">${esc(n.title)}</h2>\n      <div class="card">${esc(n.card)}</div>\n      <div class="notes">${esc(n.notes)}</div>\n      <ul class="links">${links ? `\n${links}\n      ` : ''}</ul>\n    </article>`;
  });
  return `<!doctype html>\n<html lang="${esc(graph.lang)}">\n<head>\n  <meta charset="utf-8">\n  <meta name="format" content="${FORMAT}">\n  <title>${esc(graph.title)}</title>\n${graph.resources.css.map(url => `  <link rel="stylesheet" href="${esc(url)}">`).join('\n')}\n${graph.resources.scripts.map(url => `  <script defer src="${esc(url)}"></script>`).join('\n')}\n</head>\n<body>\n  <section class="${esc(graph.classes.join(' '))}">\n${rows.join('\n')}\n  </section>\n</body>\n</html>\n`;
}

export function finishNode(graph: Graph, id: string, draft: Pick<GraphNode, Field>): boolean {
  const node = graph.nodes.find(n => n.id === id);
  if (!node) return false;
  let { title, card, notes } = draft;
  if (blank(title) && !blank(card)) [title, card] = [card, title];
  if (blank(title)) {
    graph.nodes = graph.nodes.filter(n => n.id !== id);
    graph.nodes.forEach(n => n.edges = n.edges.filter(e => e.target !== id));
    return false;
  }
  Object.assign(node, { title, card, notes }); return true;
}

import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { FORMAT, LIMITS, length, blank, type Diagnostic } from './model.ts';
type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
const element = (n: Node): n is Element => 'tagName' in n;
const children = (n: Node): Node[] => 'childNodes' in n ? n.childNodes : [];
const elements = (n: Node): Element[] => children(n).filter(element);
const all = (n: Node): Element[] => elements(n).flatMap(e => [e, ...all(e)]);
const attr = (n: Element, name: string) => n.attrs.find(a => a.name === name)?.value;
const hasClass = (n: Element, name: string) => (attr(n, 'class') ?? '').split(/\s+/).includes(name);
const text = (n: Node): string => n.nodeName === '#text' ? (n as DefaultTreeAdapterMap['textNode']).value : children(n).map(text).join('');
export interface FieldCount { object: string; occurrence: number; field: string; length: number; limit: number; excess: number }

/** Inspects the original source: no deduplication, truncation, coordinates, or repairs. */
export function checkSource(source: string) {
  const diagnostics: Diagnostic[] = [], fields: FieldCount[] = [];
  const warn = (object: string, field: string, message: string) => diagnostics.push({ object, field, message });
  const doc = parse(source, { sourceCodeLocationInfo: true, onParseError: e => warn(`行 ${e.startLine}`, 'HTML', e.code) });
  const tags = all(doc);
  const formats = tags.filter(e => e.tagName === 'meta' && attr(e, 'name') === 'format');
  const maps = tags.filter(e => e.tagName === 'section' && hasClass(e, 'map'));
  if (formats.length !== 1 || attr(formats[0], 'content') !== FORMAT) warn('文档', 'format', '格式标识缺失、重复或不支持。');
  if (maps.length !== 1) warn('文档', 'map', '需要唯一的 section.map。');
  const ids = new Map<string, number>();
  for (const el of tags) {
    const id = attr(el, 'id');
    if (id === undefined) continue;
    if (!id || /\s/.test(id)) warn(id || '元素', 'id', '标识为空或包含空白。');
    ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  for (const [id, count] of ids) if (count > 1) warn(id, 'id', `原文件出现 ${count} 次，未去重。`);
  const articles = maps.flatMap(map => elements(map).filter(e => e.tagName === 'article'));
  const nodeIds = new Set(articles.map(n => attr(n, 'id')));
  const inspectText = (el: Element, object: string, occurrence: number, field: keyof typeof LIMITS) => {
    const size = length(text(el)), limit = LIMITS[field];
    fields.push({ object, occurrence, field, length: size, limit, excess: Math.max(0, size - limit) });
    if (size > limit) warn(`${object} #${occurrence}`, field, `原始长度 ${size}，上限 ${limit}，超出 ${size - limit}。`);
    if (elements(el).length) warn(`${object} #${occurrence}`, field, '包含未转义的 HTML 子元素。');
    if (field === 'title' && blank(text(el))) warn(`${object} #${occurrence}`, field, '标题为空。');
  };
  for (const [index, node] of articles.entries()) {
    const id = attr(node, 'id') ?? '(无标识)';
    if (!attr(node, 'id')) warn(`节点 ${index + 1}`, 'id', '缺少节点标识。');
    if (!node.sourceCodeLocation?.endTag) warn(id, '结构', '节点缺少显式结束标签。');
    const direct = elements(node);
    for (const [field, tag] of [['title', 'h2'], ['card', 'div'], ['notes', 'div']] as const) {
      const matches = direct.filter(e => hasClass(e, field));
      if (matches.length !== 1 || matches[0].tagName !== tag) warn(id, field, `需要唯一的直接 ${tag}.${field} 字段。`);
      for (const el of matches) inspectText(el, id, index + 1, field);
    }
    const lists = direct.filter(e => e.tagName === 'ul' && hasClass(e, 'links'));
    if (lists.length !== 1) warn(id, 'links', '需要唯一的直接 ul.links。');
    for (const list of lists) for (const li of elements(list)) {
      const anchors = elements(li);
      if (li.tagName !== 'li' || anchors.length !== 1 || anchors[0].tagName !== 'a') { warn(id, 'links', '每条关系需要 li 内唯一的 a。'); continue; }
      const a = anchors[0], edgeId = attr(a, 'id') ?? '(无标识边)';
      if (!attr(a, 'id')) warn(id, 'links.id', '缺少边标识。');
      inspectText(a, `${id} → ${edgeId}`, index + 1, 'label');
      try {
        const href = attr(a, 'href') ?? '';
        if (!href.startsWith('#') || !nodeIds.has(decodeURIComponent(href.slice(1)))) warn(edgeId, 'href', '目标不是本图中已声明的节点。');
      } catch { warn(edgeId, 'href', '目标片段编码无效。'); }
    }
  }
  return { valid: diagnostics.length === 0, nodes: articles.length, fields, diagnostics };
}

const escapeLabel = value => value.replace(/[\r\n\t]/g, ' ').replace(/[&"#<>\[\]{}|\\`]/gu, c => `#${c.codePointAt(0)};`);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function projectMermaid(nodes, edges, orientation = 'LR', options = {}) {
  const sorted = [...nodes].sort((a, b) => compare(a.id, b.id));
  const nodeIds = {}, projectionIds = new Map(), edgeIds = [];
  sorted.forEach((node, i) => { const key = 'n_' + i; nodeIds[key] = node.id; projectionIds.set(node.id, key); });
  const next = new Map(sorted.map(n => [n.id, []]));
  for (const edge of edges) next.get(edge.source).push(edge);
  for (const list of next.values()) list.sort((a, b) => {
    const secondary = edge => ['retry', 'error'].includes(edge.meta?.flow?.role);
    return Number(secondary(a)) - Number(secondary(b)) || (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || compare(a.kind, b.kind) || compare(a.id, b.id);
  });
  const order = [], seen = new Set();
  function visit(id) {
    if (!projectionIds.has(id) || seen.has(id)) return;
    seen.add(id); order.push(id);
    for (const edge of next.get(id)) visit(edge.target);
  }
  if (options.entryNodeId) visit(options.entryNodeId);
  for (const node of sorted) visit(node.id);
  const lines = [];
  if (options.layoutHints) lines.push('---', 'config:', '  flowchart:', '    nodeSpacing: 60', '    rankSpacing: 90', '---');
  lines.push('flowchart ' + orientation);
  for (const id of order) {
    const node = nodes.find(n => n.id === id), source = options.sourceNodes?.[id] ?? node;
    const role = options.roles?.get(id) ?? source.meta?.flow?.role;
    const label = '"' + escapeLabel(node.title) + '"';
    const shape = role === 'decision' ? `{${label}}` : ['start', 'end'].includes(role) || id === options.entryNodeId ? `([${label}])` : `[${label}]`;
    lines.push(`  ${projectionIds.get(id)}${shape}`);
  }
  const sortedEdges = [...edges].sort((a, b) => compare(a.id, b.id));
  sortedEdges.forEach((edge, index) => {
    const label = edge.kind + (edge.order !== undefined ? ` order=${edge.order}` : '');
    lines.push(`  ${projectionIds.get(edge.source)} -->|"${escapeLabel(label)}"| ${projectionIds.get(edge.target)}`);
    edgeIds.push({ index, edgeId: edge.id, source: edge.source, target: edge.target, kind: edge.kind, order: edge.order ?? null });
  });
  if (options.layoutHints) {
    lines.push('%% MindMap layout hints describe intended geometry. External Mermaid viewers may ignore them; SVG preserves it exactly.');
    const payload = JSON.stringify(options.layoutHints).replace(/[\u2028\u2029]/g, c => c === '\u2028' ? '\\u2028' : '\\u2029');
    lines.push('%% mindmap-layout-v1: ' + payload);
  }
  return { text: lines.join('\n') + '\n', nodeIds, edgeIds, ...(options.layoutHints ? { layoutHints: options.layoutHints } : {}) };
}

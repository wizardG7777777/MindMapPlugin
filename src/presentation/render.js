import { prepare } from './semantics.js';
import { projectMermaid } from './mermaid.js';

export async function renderDocument(document, args) {
  const format = args.format;
  let layout = null;
  if (format === 'svg' || args.layoutHints) {
    const { layoutDocument } = await import('./layout.js');
    layout = await layoutDocument(document, args);
  }
  if (format === 'svg') {
    const { renderSvg } = await import('./svg.js');
    return { format, text: await renderSvg(document, layout), layout, layoutHints: null, warnings: layout.warnings };
  }
  const model = prepare(document, args);
  const output = projectMermaid(model.nodes, model.edges, model.orientation, { entryNodeId: model.entry, roles: new Map(model.nodes.map(n => [n.id, n.role])), layoutHints: layout });
  return { format, text: output.text, layout: null, layoutHints: layout, warnings: layout?.warnings ?? model.warnings };
}

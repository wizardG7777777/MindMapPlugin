import { limit } from '../errors.js';
import { prepare, layoutError } from './semantics.js';
import { typography, measureNodes } from './fonts.js';
import { strategies } from './strategies.js';
import { routeEdges, overlaps } from './routing.js';
import { renderLimits } from './contracts.js';

export async function layoutDocument(document, args = {}) {
  const model = prepare(document, args);
  limit('renderDocumentTitleCodePoints', renderLimits.titleCodePoints, [...document.metadata.title].length);
  const font = await typography();
  // Classify explicit role/size before placement. Algorithms may infer only
  // equally sized rounded terminal shapes after this measurement step.
  const nodes = measureNodes(model, font);
  const details = strategies[model.profile](model, nodes);
  model.fishboneRoots = details.fishboneRoots;
  model.groups = details.groups;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (overlaps(nodes[i], nodes[j], 12)) layoutError('node placement overlaps', [nodes[i].id, nodes[j].id]);
  const edges = routeEdges(model, nodes, font);
  const allBoxes = [...nodes, ...edges.map(e => e.label)];
  const allPoints = edges.flatMap(e => e.points);
  const left = Math.min(0, ...allBoxes.map(n => n.x), ...allPoints.map(p => p.x));
  const top = Math.min(0, ...allBoxes.map(n => n.y), ...allPoints.map(p => p.y));
  const right = Math.max(0, ...allBoxes.map(n => n.x + n.width), ...allPoints.map(p => p.x));
  const bottom = Math.max(0, ...allBoxes.map(n => n.y + n.height), ...allPoints.map(p => p.y));
  const width = Math.max(720, right - left + 112);
  const title = font.supported(document.metadata.title);
  if (title.missing.length) model.warnings.push({ code: 'MISSING_GLYPH', message: 'The document title uses code-point placeholders for: ' + title.missing.join(', '), nodeIds: [], edgeIds: [] });
  const header = font.wrap(title.text, Math.min(1100, width - 96), 24).length * font.lineHeight(24) + 76;
  const dx = 56 - left + (width - (right - left + 112)) / 2, dy = header + 24 - top;
  for (const node of nodes) { node.x += dx; node.y += dy; }
  for (const edge of edges) {
    for (const point of edge.points) { point.x += dx; point.y += dy; }
    edge.label.x += dx; edge.label.y += dy;
  }
  return {
    layoutVersion: 1, profile: model.profile, orientation: model.orientation,
    entryNodeId: model.entry, width, height: Math.max(230, bottom - top + header + 80),
    nodes, edges, groups: details.groups,
    constraints: {
      sameRank: details.sameRank,
      forwardEdgeIds: model.edges.filter(e => details.primary.has(e.id)).map(e => e.id),
      retryEdgeIds: model.edges.filter(e => e.role === 'retry').map(e => e.id),
      secondaryEdgeIds: model.edges.filter(e => !details.primary.has(e.id) && e.role !== 'retry').map(e => e.id),
    },
    warnings: model.warnings, font: font.identity,
  };
}

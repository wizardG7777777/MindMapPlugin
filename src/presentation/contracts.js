import { obj, arr, str, id, integer, nullable } from '../schema-primitives.js';

export const profiles = ['flowchart', 'mindmap', 'dependency', 'network', 'fishbone'];
export const renderLimits = { nodes: 500, edges: 2000, titleCodePoints: 512, svgBytes: 33554432 };
export const nodeRoles = ['start', 'action', 'decision', 'merge', 'end', 'error'];
export const edgeRoles = ['forward', 'branch', 'error', 'retry', 'cross', 'cycle'];
const number = { type: 'number' };
const positive = { type: 'number', minimum: 0 };
const point = obj({ x: number, y: number });
const box = obj({ x: number, y: number, width: positive, height: positive });
export const warning = obj({ code: str, message: str, nodeIds: arr(id), edgeIds: arr(id) });
export const flowNode = obj({ role: { enum: nodeRoles }, mergeNodeId: id }, ['role']);
export const flowEdge = obj({ role: { enum: ['forward', 'branch', 'error', 'retry'] } });
export const layoutShape = obj({
  layoutVersion: { const: 1 },
  profile: { enum: profiles }, orientation: { enum: ['TD', 'LR'] },
  entryNodeId: nullable(id), width: positive, height: positive,
  nodes: arr(obj({ id, title: str, role: { enum: nodeRoles }, shape: { enum: ['round', 'rect', 'diamond'] }, ...box.properties, rank: nullable(integer), lines: arr(str) })),
  edges: arr(obj({ id, source: id, target: id, kind: str, role: { enum: edgeRoles }, points: arr(point, { minItems: 2 }), label: obj({ ...box.properties, lines: arr(str) }) })),
  groups: arr(obj({ id: str, kind: { enum: ['alternatives', 'cycle'] }, nodeIds: arr(id), entryNodeId: nullable(id), mergeNodeId: nullable(id) })),
  constraints: obj({ sameRank: arr(obj({ nodeIds: arr(id), reason: str })), forwardEdgeIds: arr(id), retryEdgeIds: arr(id), secondaryEdgeIds: arr(id) }),
  warnings: arr(warning),
  font: obj({ family: str, version: str, size: positive }),
});
export const renderData = obj({ format: { enum: ['svg', 'mermaid'] }, text: str, layout: nullable(layoutShape), layoutHints: nullable(layoutShape), warnings: arr(warning) });

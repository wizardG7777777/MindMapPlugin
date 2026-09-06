import { dialect, obj, arr, str, bool, nil, integer, id, text, trimmed, timestamp, jsonValue, meta, ids, nullable } from './schema-primitives.js';
export * from './schema-primitives.js';
import { layoutShape } from './presentation/contracts.js';
export const summary = obj({ operationCount: { ...integer, minimum: 1, maximum: 10000 }, nodeCount: integer, edgeCount: integer });
export const actor = obj({ kind: { enum: ['human', 'agent', 'system'] }, name: text });
export const node = obj({ id, title: trimmed, cardContent: str, notes: str, meta });
export const edge = obj({ id, source: id, target: id, kind: trimmed, order: integer, meta }, ['id', 'source', 'target', 'kind', 'meta']);
export const receipt = obj({ operationId: id, requestHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, baseGraphVersion: integer, committedGraphVersion: { ...integer, minimum: 1 }, committedAt: timestamp, actor, affectedNodeIds: ids, affectedEdgeIds: ids, summary }, ['operationId', 'requestHash', 'baseGraphVersion', 'committedGraphVersion', 'committedAt', 'affectedNodeIds', 'affectedEdgeIds', 'summary']);
export const metadata = obj({ id, title: trimmed, graphVersion: integer, createdAt: timestamp, updatedAt: timestamp });
const map = record => ({ type: 'object', propertyNames: id, additionalProperties: record });
export const graph = obj({ topology: { const: 'directed' }, semanticType: trimmed, entryNodeId: nullable(id), nodes: map(node), edges: map(edge) });
export const document = obj({ 'JSON-SchemaVersion': { const: 2 }, metadata, graph, commits: arr(receipt) });
const newNode = obj({ id, title: text, cardContent: str, notes: str, meta }, ['id', 'title']);
const newEdge = obj({ id, source: id, target: id, kind: text, order: integer, meta }, ['id', 'source', 'target', 'kind']);
const patch = properties => ({ ...obj(properties, []), minProperties: 1 });
const operation = (type, properties) => obj({ type: { const: type }, ...properties });
export const operationTypes = {
  addNode: operation('addNode', { node: newNode }),
  updateNode: operation('updateNode', { nodeId: id, patch: patch({ title: text, cardContent: str, notes: str, meta }) }),
  removeNode: operation('removeNode', { nodeId: id, edgePolicy: { const: 'removeIncidentEdges' } }),
  addEdge: operation('addEdge', { edge: newEdge }),
  updateEdge: operation('updateEdge', { edgeId: id, patch: patch({ source: id, target: id, kind: text, order: nullable(integer), meta }) }),
  removeEdge: operation('removeEdge', { edgeId: id }),
  setEntryNode: operation('setEntryNode', { nodeId: nullable(id) }),
  reorderEdges: operation('reorderEdges', { source: id, kind: text, edgeIds: ids }),
  updateDocument: operation('updateDocument', { patch: patch({ title: text, semanticType: text }) }),
};
export const writeScope = { oneOf: [obj({ mode: { const: 'document' }, allowDelete: bool }), obj({ mode: { const: 'ids' }, nodeIds: ids, edgeIds: ids, allowDelete: bool })] };
export const operations = obj({ envelopeVersion: { const: 1 }, documentId: id, baseGraphVersion: integer, operationId: id, actor, scope: writeScope, operations: arr({ oneOf: Object.values(operationTypes) }, { minItems: 1, maxItems: 10000 }) }, ['envelopeVersion', 'documentId', 'baseGraphVersion', 'operationId', 'scope', 'operations']);
export const queryDefaults = { maxNodes: 200, maxEdges: 400, maxBoundaryEdges: 100, maxTextBytes: 4096 };
export const queryMaximums = { maxNodes: 10000, maxEdges: 20000, maxBoundaryEdges: 20000, maxTextBytes: 1048576 };
export const limits = { documentBytes: 67108864, operationInputBytes: 8388608, operationsPerBatch: 10000, idMaxCharacters: 128, queryDefaults, queryMaximums, depthMaximum: 100, lockTimeoutDefaultMs: 5000, lockTimeoutMaximumMs: 60000 };
export const queryLimits = obj(Object.fromEntries(Object.keys(queryDefaults).map(key => [key, { ...integer, minimum: ['maxNodes','maxEdges'].includes(key) ? 1 : 0, maximum: queryMaximums[key] }])));
export const selectedNode = { oneOf: [obj({ id, title: str }), obj({ id, title: str, cardContent: str }), obj({ id, title: str, cardContent: str, notes: str, meta })] };
export const fieldOmission = obj({ nodeId: id, field: { enum: ['title', 'cardContent', 'notes', 'meta'] }, reason: { enum: ['not_requested', 'text_limit'] }, omittedBytes: integer });
export const boundary = obj({ id, source: id, target: id, kind: trimmed });
export const mermaid = obj({ text: str, nodeIds: { type: 'object', patternProperties: { '^n_[0-9]+$': id }, additionalProperties: false }, edgeIds: arr(obj({ index: integer, edgeId: id, source: id, target: id, kind: trimmed, order: nullable(integer) })), layoutHints: layoutShape }, ['text', 'nodeIds', 'edgeIds']);
export const context = obj({
  scope: { oneOf: [
    obj({ mode: { const: 'all' }, nodeIds: { ...ids, maxItems: 0 }, edgeIds: { ...ids, maxItems: 0 }, direction: nil, depth: nil, kinds: nullable(arr(trimmed, { uniqueItems: true, minItems: 1 })), limits: queryLimits }),
    { ...obj({ mode: { const: 'ids' }, nodeIds: ids, edgeIds: ids, direction: { enum: ['outgoing', 'incoming', 'both'] }, depth: { ...integer, maximum: 100 }, kinds: nullable(arr(trimmed, { uniqueItems: true, minItems: 1 })), limits: queryLimits }), anyOf: [{ properties: { nodeIds: { minItems: 1 } } }, { properties: { edgeIds: { minItems: 1 } } }] },
    obj({ mode: { const: 'neighbors' }, nodeIds: { ...ids, minItems: 1, maxItems: 1 }, edgeIds: { ...ids, maxItems: 0 }, direction: { enum: ['outgoing', 'incoming', 'both'] }, depth: { const: 1 }, kinds: nullable(arr(trimmed, { uniqueItems: true, minItems: 1 })), limits: queryLimits }),
  ] },
  nodes: arr(selectedNode), edges: arr(edge), boundaryEdges: arr(boundary),
  omissions: obj({ nodes: integer, edges: integer, boundaryEdges: integer, fields: arr(fieldOmission) }), mermaid: nullable(mermaid),
});
export const semanticDocument = obj({ title: trimmed, semanticType: trimmed, entryNodeId: nullable(id) });
export const preview = obj({ operationId: id, baseGraphVersion: integer, nextGraphVersion: { ...integer, minimum: 1 }, operationCount: summary.properties.operationCount, affectedNodeIds: ids, affectedEdgeIds: ids, diff: obj({ nodes: arr(obj({ id, before: nullable(node), after: nullable(node) })), edges: arr(obj({ id, before: nullable(edge), after: nullable(edge) })), document: nullable(obj({ before: semanticDocument, after: semanticDocument })) }), summary });
export function schema(name, shape, defs = {}) {
  return { $schema: dialect, $id: `urn:mindmap-cli:contract:1:${name}`, ...shape, $defs: { jsonValue, ...defs } };
}

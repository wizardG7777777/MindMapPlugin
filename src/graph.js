import { fail } from './errors.js';
import { sorted, equal, validateDocument } from './validation.js';

export function createDocument(id, title, now = new Date().toISOString()) {
  return validateDocument({ 'JSON-SchemaVersion': 2, metadata: { id, title: title.trim(), graphVersion: 0, createdAt: now, updatedAt: now }, graph: { topology: 'directed', semanticType: 'general', entryNodeId: null, nodes: {}, edges: {} }, commits: [] });
}
export function checkIdentity(document, envelope) {
  if (envelope.documentId !== document.metadata.id) fail('INVALID_ENVELOPE', 'The request belongs to a different document.', { field: 'documentId', reason: 'identity mismatch', expected: document.metadata.id, actual: envelope.documentId });
}
export function checkVersion(document, envelope, apply = false) {
  if (document.metadata.graphVersion !== envelope.baseGraphVersion) fail('CONFLICT', 'The graph changed. Reread and reconsider a new batch.', { expectedVersion: envelope.baseGraphVersion, currentVersion: document.metadata.graphVersion, ...(apply ? { operationId: envelope.operationId, committed: false } : {}) });
}
const semantic = document => ({ title: document.metadata.title, semanticType: document.graph.semanticType, entryNodeId: document.graph.entryNodeId });

export function edit(document, envelope, applying = false) {
  checkIdentity(document,envelope);
  checkVersion(document,envelope,applying);
  const draft = structuredClone(document);
  const { nodes, edges } = draft.graph;
  const affectedNodes = new Set();
  const affectedEdges = new Set();
  const allowedNodes = new Set(envelope.scope.nodeIds ?? []);
  const allowedEdges = new Set(envelope.scope.edgeIds ?? []);
  let entryNeedsReset = false;
  for (const [operationIndex, op] of envelope.operations.entries()) {
    const changedNodes = new Set();
    const changedEdges = new Set();
    const documentFields = [];
    let deletion = false;
    const invalid = (reason, extra = {}) => fail('INVALID_OPERATION', `Operation ${operationIndex} (${op.type}): ${reason}`, { operationIndex, type: op.type, reason, ...extra });
    const existing = (records, id) => { if (!Object.hasOwn(records,id)) invalid('target_missing',{id}); return records[id]; };
    const absent = (records, id) => { if (Object.hasOwn(records,id)) invalid('id_exists',{id}); };
    const touchEdge = edge => { changedEdges.add(edge.id); changedNodes.add(edge.source); changedNodes.add(edge.target); };
    const endpoints = edge => { for (const id of [edge.source,edge.target]) if (!Object.hasOwn(nodes,id)) invalid('endpoint_missing',{id}); };
    switch (op.type) {
      case 'addNode': {
        absent(nodes,op.node.id);
        const n = { id: op.node.id, title: op.node.title.trim(), cardContent: op.node.cardContent ?? '', notes: op.node.notes ?? '', meta: structuredClone(op.node.meta ?? {}) };
        nodes[n.id] = n; changedNodes.add(n.id); break;
      }
      case 'updateNode': {
        const n = existing(nodes,op.nodeId);
        Object.assign(n,structuredClone(op.patch));
        n.title = n.title.trim(); changedNodes.add(n.id); break;
      }
      case 'removeNode': {
        existing(nodes,op.nodeId);
        for (const edge of Object.values(edges)) if (edge.source === op.nodeId || edge.target === op.nodeId) { touchEdge(edge); delete edges[edge.id]; }
        delete nodes[op.nodeId]; changedNodes.add(op.nodeId); deletion = true;
        if (draft.graph.entryNodeId === op.nodeId) entryNeedsReset = true;
        break;
      }
      case 'addEdge': {
        absent(edges,op.edge.id); endpoints(op.edge);
        const e = { ...structuredClone(op.edge), kind: op.edge.kind.trim(), meta: structuredClone(op.edge.meta ?? {}) };
        edges[e.id] = e; touchEdge(e); break;
      }
      case 'updateEdge': {
        const e = existing(edges,op.edgeId); touchEdge(e);
        Object.assign(e,structuredClone(op.patch)); e.kind = e.kind.trim();
        if (e.order === null) delete e.order;
        endpoints(e); touchEdge(e); break;
      }
      case 'removeEdge': {
        touchEdge(existing(edges,op.edgeId)); delete edges[op.edgeId]; deletion = true; break;
      }
      case 'setEntryNode': {
        if (op.nodeId !== null) existing(nodes,op.nodeId);
        draft.graph.entryNodeId = op.nodeId; documentFields.push('entryNodeId'); entryNeedsReset = false; break;
      }
      case 'reorderEdges': {
        existing(nodes,op.source); changedNodes.add(op.source);
        const expectedEdgeIds = sorted(Object.values(edges).filter(e => e.source === op.source && e.kind === op.kind.trim()).map(e => e.id));
        if (!equal(expectedEdgeIds,sorted(op.edgeIds))) invalid('edge_set_mismatch',{expectedEdgeIds,actualEdgeIds:op.edgeIds});
        op.edgeIds.forEach((id,order) => { edges[id].order = order; touchEdge(edges[id]); }); break;
      }
      case 'updateDocument': {
        if (op.patch.title !== undefined) { draft.metadata.title = op.patch.title.trim(); documentFields.push('title'); }
        if (op.patch.semanticType !== undefined) { draft.graph.semanticType = op.patch.semanticType.trim(); documentFields.push('semanticType'); }
        break;
      }
      default: invalid('unknown_type');
    }
    const restricted = envelope.scope.mode === 'ids';
    const deniedNodes = restricted ? sorted([...changedNodes].filter(id => !allowedNodes.has(id))) : [];
    const deniedEdges = restricted ? sorted([...changedEdges].filter(id => !allowedEdges.has(id))) : [];
    const deniedFields = restricted ? sorted(documentFields) : [];
    if (deniedNodes.length || deniedEdges.length || deniedFields.length || (deletion && !envelope.scope.allowDelete)) {
      fail('SCOPE_VIOLATION', 'The batch exceeds its declared write scope.', { nodeIds: deniedNodes, edgeIds: deniedEdges, documentFields: deniedFields, reason: deletion && !envelope.scope.allowDelete ? 'delete_not_allowed' : 'target_not_allowed', operationIndex });
    }
    for (const id of changedNodes) affectedNodes.add(id);
    for (const id of changedEdges) affectedEdges.add(id);
  }
  if (entryNeedsReset) fail('INVALID_OPERATION', 'Removing the entry node requires an explicit setEntryNode operation.', { reason: 'invalid_final_graph', field: 'graph.entryNodeId' });
  try { validateDocument(draft); }
  catch (error) {
    if (error.code !== 'INVALID_DOCUMENT') throw error;
    fail('INVALID_OPERATION', error.message, { reason: 'invalid_final_graph', field: error.details.field });
  }
  if (document.metadata.graphVersion === Number.MAX_SAFE_INTEGER) fail('LIMIT_EXCEEDED','Graph version exhausted.',{limit:'graphVersion',maximum:Number.MAX_SAFE_INTEGER,actual:Number.MAX_SAFE_INTEGER});
  const affectedNodeIds = sorted(affectedNodes), affectedEdgeIds = sorted(affectedEdges);
  const diff = (before, after, ids) => ids.flatMap(id => {
    const b = Object.hasOwn(before,id) ? before[id] : null, a = Object.hasOwn(after,id) ? after[id] : null;
    return equal(b,a) ? [] : [{ id, before: b, after: a }];
  });
  const before = semantic(document), after = semantic(draft);
  const summary = { operationCount: envelope.operations.length, nodeCount: affectedNodeIds.length, edgeCount: affectedEdgeIds.length };
  return { draft, preview: { operationId: envelope.operationId, baseGraphVersion: document.metadata.graphVersion, nextGraphVersion: document.metadata.graphVersion + 1, operationCount: envelope.operations.length, affectedNodeIds, affectedEdgeIds, diff: { nodes: diff(document.graph.nodes,nodes,affectedNodeIds), edges: diff(document.graph.edges,edges,affectedEdgeIds), document: equal(before,after) ? null : { before, after } }, summary } };
}

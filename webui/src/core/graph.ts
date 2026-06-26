import { ConflictError, ToolInputError, ValidationError } from './errors.js';

export type JsonObject = Record<string, unknown>;

export type GraphNode = {
  id: string;
  title: string;
  cardContent?: string;
  notes?: string;
  meta?: JsonObject;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  order?: number;
  meta?: JsonObject;
};

export type GraphDocument = {
  'JSON-SchemaVersion': number;
  metadata: {
    id: string;
    title: string;
    graphVersion: number;
    createdAt?: string;
    updatedAt?: string;
  };
  document: JsonObject;
  graph: {
    diagramKind: string;
    entryNodeId: string;
    nodes: Record<string, GraphNode>;
    edges: Record<string, GraphEdge>;
  };
};

export type GraphOperation =
  | { type: 'addNode'; node: GraphNode }
  | { type: 'updateNode'; nodeId: string; patch: Partial<Pick<GraphNode, 'title' | 'cardContent' | 'notes' | 'meta'>> }
  | { type: 'removeNode'; nodeId: string; edgePolicy: 'removeIncidentEdges' }
  | { type: 'addEdge'; edge: GraphEdge }
  | { type: 'updateEdge'; edgeId: string; patch: Partial<Pick<GraphEdge, 'source' | 'target' | 'kind' | 'order' | 'meta'>> }
  | { type: 'removeEdge'; edgeId: string }
  | { type: 'setEntryNode'; nodeId: string }
  | { type: 'reorderEdges'; source: string; kind: string; edgeIds: Array<string> };

export type OperationEnvelope = {
  documentId: string;
  baseGraphVersion: number;
  operations: Array<GraphOperation>;
  scopeRestrictions?: {
    allowedNodeIds?: Array<string>;
    allowedEdgeIds?: Array<string>;
    forbiddenNodeIds?: Array<string>;
    allowedEdgeKinds?: Array<string>;
    disallowDeleteOperations?: boolean;
  };
};

export type OperationPreview = {
  ok: true;
  documentId: string;
  baseGraphVersion: number;
  nextGraphVersion: number;
  operationCount: number;
  affectedNodeIds: Array<string>;
  affectedEdgeIds: Array<string>;
  summary: string;
};

export const knownDiagramKinds = new Set(['mindmap', 'fishbone', 'flowchart', 'concept-map', 'dependency-graph']);
const nodeFields = new Set(['id', 'title', 'cardContent', 'notes', 'meta']);
const nodePatchFields = new Set(['title', 'cardContent', 'notes', 'meta']);
const edgeFields = new Set(['id', 'source', 'target', 'kind', 'order', 'meta']);
const edgePatchFields = new Set(['source', 'target', 'kind', 'order', 'meta']);

export function utcNow(): string {
  return new Date().toISOString();
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function normalizeNode(node: Partial<GraphNode>): GraphNode {
  return {
    ...node,
    id: node.id ?? '',
    title: node.title ?? '',
    cardContent: node.cardContent ?? '',
    notes: node.notes ?? '',
    meta: node.meta ?? {},
  };
}

export function normalizeEdge(edge: Partial<GraphEdge>): GraphEdge {
  return {
    ...edge,
    id: edge.id ?? '',
    source: edge.source ?? '',
    target: edge.target ?? '',
    kind: edge.kind ?? 'contains',
    meta: edge.meta ?? {},
  };
}

export function validateDocument(document: unknown): asserts document is GraphDocument {
  if (!isRecord(document)) {
    throw new ValidationError('Document must be a JSON object.');
  }
  if (document['JSON-SchemaVersion'] !== 1) {
    throw new ValidationError('Unsupported JSON-SchemaVersion.', {
      expected: 1,
      actual: document['JSON-SchemaVersion'],
    });
  }

  const metadata = document.metadata;
  const graph = document.graph;
  if (!isRecord(metadata)) {
    throw new ValidationError('metadata must be an object.');
  }
  if (!isRecord(graph)) {
    throw new ValidationError('graph must be an object.');
  }
  if (typeof metadata.id !== 'string' || metadata.id.length === 0) {
    throw new ValidationError('metadata.id must be a non-empty string.');
  }
  if (!Number.isInteger(metadata.graphVersion)) {
    throw new ValidationError('metadata.graphVersion must be an integer.');
  }
  if (!knownDiagramKinds.has(String(graph.diagramKind))) {
    throw new ValidationError('graph.diagramKind is not registered.', { diagramKind: graph.diagramKind });
  }
  if (!isRecord(graph.nodes)) {
    throw new ValidationError('graph.nodes must be an object keyed by node id.');
  }
  if (!isRecord(graph.edges)) {
    throw new ValidationError('graph.edges must be an object keyed by edge id.');
  }
  if (typeof graph.entryNodeId !== 'string' || !isRecord(graph.nodes[graph.entryNodeId])) {
    throw new ValidationError('graph.entryNodeId must exist in graph.nodes.', { entryNodeId: graph.entryNodeId });
  }

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (!isRecord(node)) {
      throw new ValidationError('Each node must be an object.', { nodeId });
    }
    if (node.id !== nodeId) {
      throw new ValidationError('Node id must match its map key.', { key: nodeId, nodeId: node.id });
    }
    const unknown = Object.keys(node).filter((field) => !nodeFields.has(field));
    if (unknown.length > 0) {
      throw new ValidationError('Node contains unsupported canonical fields.', { nodeId, fields: unknown.sort() });
    }
    if (typeof node.title !== 'string' || node.title.trim().length === 0) {
      throw new ValidationError('Node title must be non-empty.', { nodeId });
    }
    if (typeof (node.cardContent ?? '') !== 'string') {
      throw new ValidationError('Node cardContent must be a string.', { nodeId });
    }
    if (typeof (node.notes ?? '') !== 'string') {
      throw new ValidationError('Node notes must be a string.', { nodeId });
    }
    if (!isRecord(node.meta ?? {})) {
      throw new ValidationError('Node meta must be an object.', { nodeId });
    }
  }

  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (!isRecord(edge)) {
      throw new ValidationError('Each edge must be an object.', { edgeId });
    }
    if (edge.id !== edgeId) {
      throw new ValidationError('Edge id must match its map key.', { key: edgeId, edgeId: edge.id });
    }
    const unknown = Object.keys(edge).filter((field) => !edgeFields.has(field));
    if (unknown.length > 0) {
      throw new ValidationError('Edge contains unsupported canonical fields.', { edgeId, fields: unknown.sort() });
    }
    if (typeof edge.source !== 'string' || !isRecord(graph.nodes[edge.source])) {
      throw new ValidationError('Edge source must exist in graph.nodes.', { edgeId, source: edge.source });
    }
    if (typeof edge.target !== 'string' || !isRecord(graph.nodes[edge.target])) {
      throw new ValidationError('Edge target must exist in graph.nodes.', { edgeId, target: edge.target });
    }
    if (typeof edge.kind !== 'string' || edge.kind.trim().length === 0) {
      throw new ValidationError('Edge kind must be a non-empty string.', { edgeId });
    }
    if ('order' in edge && !Number.isInteger(edge.order)) {
      throw new ValidationError('Edge order must be an integer when present.', { edgeId });
    }
    if (!isRecord(edge.meta ?? {})) {
      throw new ValidationError('Edge meta must be an object.', { edgeId });
    }
  }
}

export function summarizeDocument(document: GraphDocument): {
  documentId: string;
  title: string;
  graphVersion: number;
  diagramKind: string;
  entryNodeId: string;
  nodeCount: number;
  edgeCount: number;
  relationCounts: Record<string, number>;
} {
  validateDocument(document);
  const relationCounts: Record<string, number> = {};
  for (const edge of Object.values(document.graph.edges)) {
    relationCounts[edge.kind] = (relationCounts[edge.kind] ?? 0) + 1;
  }
  return {
    documentId: document.metadata.id,
    title: document.metadata.title,
    graphVersion: document.metadata.graphVersion,
    diagramKind: document.graph.diagramKind,
    entryNodeId: document.graph.entryNodeId,
    nodeCount: Object.keys(document.graph.nodes).length,
    edgeCount: Object.keys(document.graph.edges).length,
    relationCounts,
  };
}

export function getNode(document: GraphDocument, nodeId: string): GraphNode {
  validateDocument(document);
  const node = document.graph.nodes[nodeId];
  if (!node) {
    throw new ToolInputError('Node does not exist.', { nodeId });
  }
  return clone(node);
}

export function sortedEdges(edges: Record<string, GraphEdge>): Array<GraphEdge> {
  return Object.values(edges).sort((left, right) =>
    [
      left.source.localeCompare(right.source),
      left.kind.localeCompare(right.kind),
      (left.order ?? 1_000_000_000) - (right.order ?? 1_000_000_000),
      left.id.localeCompare(right.id),
      left.target.localeCompare(right.target),
    ].find((value) => value !== 0) ?? 0,
  );
}

export function getNeighbors(
  document: GraphDocument,
  nodeId: string,
  direction: 'outgoing' | 'incoming' | 'both' = 'both',
): { nodeId: string; incoming: Array<GraphEdge>; outgoing: Array<GraphEdge> } {
  validateDocument(document);
  if (!document.graph.nodes[nodeId]) {
    throw new ToolInputError('Node does not exist.', { nodeId });
  }
  if (!['outgoing', 'incoming', 'both'].includes(direction)) {
    throw new ToolInputError('direction must be outgoing, incoming, or both.', { direction });
  }
  const incoming: Array<GraphEdge> = [];
  const outgoing: Array<GraphEdge> = [];
  for (const edge of sortedEdges(document.graph.edges)) {
    if ((direction === 'outgoing' || direction === 'both') && edge.source === nodeId) {
      outgoing.push(clone(edge));
    }
    if ((direction === 'incoming' || direction === 'both') && edge.target === nodeId) {
      incoming.push(clone(edge));
    }
  }
  return { nodeId, incoming, outgoing };
}

export function previewOperations(document: GraphDocument, envelope: OperationEnvelope): OperationPreview {
  validateDocument(document);
  if (envelope.documentId !== document.metadata.id) {
    throw new ValidationError('Operation envelope documentId does not match document.', { documentId: envelope.documentId });
  }
  if (envelope.baseGraphVersion !== document.metadata.graphVersion) {
    throw new ConflictError('Operation envelope is based on a stale graphVersion.', {
      baseGraphVersion: envelope.baseGraphVersion,
      currentGraphVersion: document.metadata.graphVersion,
    });
  }
  if (!Array.isArray(envelope.operations)) {
    throw new ValidationError('Operation envelope requires operations array.');
  }
  checkScope(document, envelope);

  const draft = clone(document);
  const affected = new Set<string>();
  for (const operation of envelope.operations) {
    for (const value of applyOperation(draft, operation)) {
      affected.add(`${value.kind}:${value.id}`);
    }
  }
  validateDocument(draft);

  const affectedNodeIds = [...affected]
    .filter((value) => value.startsWith('node:'))
    .map((value) => value.slice('node:'.length))
    .sort();
  const affectedEdgeIds = [...affected]
    .filter((value) => value.startsWith('edge:'))
    .map((value) => value.slice('edge:'.length))
    .sort();
  return {
    ok: true,
    documentId: document.metadata.id,
    baseGraphVersion: document.metadata.graphVersion,
    nextGraphVersion: document.metadata.graphVersion + 1,
    operationCount: envelope.operations.length,
    affectedNodeIds,
    affectedEdgeIds,
    summary: `${envelope.operations.length} operation(s), ${affectedNodeIds.length} node(s), ${affectedEdgeIds.length} edge(s) affected.`,
  };
}

export function applyOperations(
  document: GraphDocument,
  envelope: OperationEnvelope,
): { document: GraphDocument; result: OperationPreview & { applied: true } } {
  const preview = previewOperations(document, envelope);
  const draft = clone(document);
  for (const operation of envelope.operations) {
    applyOperation(draft, operation);
  }
  draft.metadata.graphVersion += 1;
  draft.metadata.updatedAt = utcNow();
  validateDocument(draft);
  return { document: draft, result: { ...preview, applied: true } };
}

function applyOperation(document: GraphDocument, operation: GraphOperation): Array<{ kind: 'node' | 'edge'; id: string }> {
  const { nodes, edges } = document.graph;
  const affected: Array<{ kind: 'node' | 'edge'; id: string }> = [];

  switch (operation.type) {
    case 'addNode': {
      const node = normalizeNode(operation.node);
      if (!node.id) {
        throw new ValidationError('addNode requires node.id.');
      }
      if (nodes[node.id]) {
        throw new ValidationError('addNode node.id already exists.', { nodeId: node.id });
      }
      nodes[node.id] = node;
      affected.push({ kind: 'node', id: node.id });
      return affected;
    }
    case 'updateNode': {
      if (!nodes[operation.nodeId]) {
        throw new ValidationError('updateNode target does not exist.', { nodeId: operation.nodeId });
      }
      assertPatchFields(operation.patch, nodePatchFields, 'updateNode patch contains unsupported fields.', {
        nodeId: operation.nodeId,
      });
      nodes[operation.nodeId] = { ...nodes[operation.nodeId], ...operation.patch };
      affected.push({ kind: 'node', id: operation.nodeId });
      return affected;
    }
    case 'removeNode': {
      if (!nodes[operation.nodeId]) {
        throw new ValidationError('removeNode target does not exist.', { nodeId: operation.nodeId });
      }
      if (operation.edgePolicy !== 'removeIncidentEdges') {
        throw new ValidationError('removeNode requires edgePolicy removeIncidentEdges.', { nodeId: operation.nodeId });
      }
      delete nodes[operation.nodeId];
      affected.push({ kind: 'node', id: operation.nodeId });
      for (const [edgeId, edge] of Object.entries({ ...edges })) {
        if (edge.source === operation.nodeId || edge.target === operation.nodeId) {
          delete edges[edgeId];
          affected.push({ kind: 'edge', id: edgeId });
        }
      }
      return affected;
    }
    case 'addEdge': {
      const edge = normalizeEdge(operation.edge);
      if (!edge.id) {
        throw new ValidationError('addEdge requires edge.id.');
      }
      if (edges[edge.id]) {
        throw new ValidationError('addEdge edge.id already exists.', { edgeId: edge.id });
      }
      edges[edge.id] = edge;
      affected.push({ kind: 'edge', id: edge.id });
      return affected;
    }
    case 'updateEdge': {
      if (!edges[operation.edgeId]) {
        throw new ValidationError('updateEdge target does not exist.', { edgeId: operation.edgeId });
      }
      assertPatchFields(operation.patch, edgePatchFields, 'updateEdge patch contains unsupported fields.', {
        edgeId: operation.edgeId,
      });
      edges[operation.edgeId] = { ...edges[operation.edgeId], ...operation.patch };
      affected.push({ kind: 'edge', id: operation.edgeId });
      return affected;
    }
    case 'removeEdge': {
      if (!edges[operation.edgeId]) {
        throw new ValidationError('removeEdge target does not exist.', { edgeId: operation.edgeId });
      }
      delete edges[operation.edgeId];
      affected.push({ kind: 'edge', id: operation.edgeId });
      return affected;
    }
    case 'setEntryNode': {
      if (!nodes[operation.nodeId]) {
        throw new ValidationError('setEntryNode target does not exist.', { nodeId: operation.nodeId });
      }
      document.graph.entryNodeId = operation.nodeId;
      affected.push({ kind: 'node', id: operation.nodeId });
      return affected;
    }
    case 'reorderEdges': {
      if (!nodes[operation.source]) {
        throw new ValidationError('reorderEdges source does not exist.', { source: operation.source });
      }
      if (!operation.kind) {
        throw new ValidationError('reorderEdges kind must be a non-empty string.');
      }
      const matching = sortedEdges(edges)
        .filter((edge) => edge.source === operation.source && edge.kind === operation.kind)
        .map((edge) => edge.id);
      if (JSON.stringify([...operation.edgeIds].sort()) !== JSON.stringify([...matching].sort())) {
        throw new ValidationError('reorderEdges must include exactly all matching edges.', {
          expected: matching,
          actual: operation.edgeIds,
        });
      }
      operation.edgeIds.forEach((edgeId, order) => {
        edges[edgeId].order = order;
        affected.push({ kind: 'edge', id: edgeId });
      });
      return affected;
    }
    default:
      throw new ValidationError('Unsupported operation type.', { type: (operation as { type?: unknown }).type });
  }
}

function checkScope(document: GraphDocument, envelope: OperationEnvelope): void {
  const restrictions = envelope.scopeRestrictions ?? {};
  const allowedNodes = new Set(restrictions.allowedNodeIds ?? []);
  const allowedEdges = new Set(restrictions.allowedEdgeIds ?? []);
  const forbiddenNodes = new Set(restrictions.forbiddenNodeIds ?? []);
  const allowedEdgeKinds = new Set(restrictions.allowedEdgeKinds ?? []);
  const disallowDelete = Boolean(restrictions.disallowDeleteOperations);

  for (const operation of envelope.operations) {
    const nodeIds = new Set<string>();
    const edgeIds = new Set<string>();
    const edgeKinds = new Set<string>();
    if (disallowDelete && ['removeNode', 'removeEdge'].includes(operation.type)) {
      throw new ValidationError('Delete operations are disallowed by scope restrictions.', { type: operation.type });
    }
    if ('nodeId' in operation) {
      nodeIds.add(operation.nodeId);
    }
    if (operation.type === 'addNode') {
      nodeIds.add(operation.node.id);
    }
    if (operation.type === 'addEdge') {
      edgeIds.add(operation.edge.id);
      nodeIds.add(operation.edge.source);
      nodeIds.add(operation.edge.target);
      edgeKinds.add(operation.edge.kind ?? 'contains');
    }
    if ('edgeId' in operation) {
      edgeIds.add(operation.edgeId);
      const existing = document.graph.edges[operation.edgeId];
      if (existing) {
        nodeIds.add(existing.source);
        nodeIds.add(existing.target);
        edgeKinds.add(existing.kind);
      }
    }
    if (operation.type === 'reorderEdges') {
      nodeIds.add(operation.source);
      operation.edgeIds.forEach((edgeId) => edgeIds.add(edgeId));
      edgeKinds.add(operation.kind);
    }

    const forbiddenTouched = intersection(forbiddenNodes, nodeIds);
    if (forbiddenTouched.length > 0) {
      throw new ValidationError('Operation touches forbidden nodes.', { nodeIds: forbiddenTouched.sort() });
    }
    const outOfScopeNodes = difference(nodeIds, allowedNodes);
    if (allowedNodes.size > 0 && outOfScopeNodes.length > 0) {
      throw new ValidationError('Operation exceeds allowed node scope.', { nodeIds: outOfScopeNodes.sort() });
    }
    const outOfScopeEdges = difference(edgeIds, allowedEdges);
    if (allowedEdges.size > 0 && edgeIds.size > 0 && outOfScopeEdges.length > 0) {
      throw new ValidationError('Operation exceeds allowed edge scope.', { edgeIds: outOfScopeEdges.sort() });
    }
    const outOfScopeKinds = difference(edgeKinds, allowedEdgeKinds);
    if (allowedEdgeKinds.size > 0 && edgeKinds.size > 0 && outOfScopeKinds.length > 0) {
      throw new ValidationError('Operation exceeds allowed edge kinds.', { edgeKinds: outOfScopeKinds.sort() });
    }
  }
}

function assertPatchFields(patch: unknown, allowed: Set<string>, message: string, details: JsonObject): void {
  if (!isRecord(patch)) {
    throw new ValidationError(message.replace('contains unsupported fields', 'must be an object'), details);
  }
  const unknown = Object.keys(patch).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    throw new ValidationError(message, { ...details, fields: unknown.sort() });
  }
}

function intersection(left: Set<string>, right: Set<string>): Array<string> {
  return [...left].filter((value) => right.has(value));
}

function difference(left: Set<string>, right: Set<string>): Array<string> {
  return [...left].filter((value) => !right.has(value));
}

export function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

import { clone, type GraphDocument, type GraphEdge, type GraphNode, sortedEdges, validateDocument } from './graph.js';
import { ToolInputError } from './errors.js';

export type GraphProjection = {
  type: 'subtree' | 'full' | 'selection';
  documentId: string;
  graphVersion: number;
  rootNodeId: string | null;
  direction?: 'outgoing' | 'incoming' | 'both';
  maxDepth?: number;
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge & { marker?: 'cycle' | 'repeated' }>;
  includedNodeIds: Array<string>;
  includedEdgeIds: Array<string>;
  markers: Array<{ edgeId: string; source: string; target: string; marker: 'cycle' | 'repeated' }>;
  omissions: Record<string, unknown>;
};

export function extractSubtree(
  document: GraphDocument,
  startNodeId: string,
  direction: 'outgoing' | 'incoming' | 'both' = 'outgoing',
  maxDepth = 3,
  cyclePolicy = 'mark',
): GraphProjection {
  validateDocument(document);
  if (!document.graph.nodes[startNodeId]) {
    throw new ToolInputError('startNodeId does not exist.', { startNodeId });
  }
  if (!['outgoing', 'incoming', 'both'].includes(direction)) {
    throw new ToolInputError('direction must be outgoing, incoming, or both.', { direction });
  }
  if (cyclePolicy !== 'mark') {
    throw new ToolInputError('Only cyclePolicy=mark is supported in v1.', { cyclePolicy });
  }
  if (maxDepth < 0) {
    throw new ToolInputError('maxDepth must be >= 0.', { maxDepth });
  }

  const { nodes, edges } = document.graph;
  const includedNodes: Record<string, GraphNode> = {};
  const includedEdges: GraphProjection['edges'] = {};
  const markers: GraphProjection['markers'] = [];
  const emittedNodes = new Set<string>();

  const outgoingEdges = (nodeId: string): Array<GraphEdge> =>
    Object.values(edges)
      .filter((edge) => edge.source === nodeId)
      .sort(edgeSort);
  const incomingEdges = (nodeId: string): Array<GraphEdge> =>
    Object.values(edges)
      .filter((edge) => edge.target === nodeId)
      .sort(edgeSort);
  const selectableEdges = (nodeId: string): Array<GraphEdge> => {
    const selected: Array<GraphEdge> = [];
    if (direction === 'outgoing' || direction === 'both') selected.push(...outgoingEdges(nodeId));
    if (direction === 'incoming' || direction === 'both') selected.push(...incomingEdges(nodeId));
    return Object.values(Object.fromEntries(selected.map((edge) => [edge.id, edge]))).sort(edgeSort);
  };

  const visit = (nodeId: string, depth: number, path: Array<string>): void => {
    includedNodes[nodeId] = clone(nodes[nodeId]);
    emittedNodes.add(nodeId);
    if (depth >= maxDepth) return;
    for (const edge of selectableEdges(nodeId)) {
      const nextNodeId = edge.source === nodeId ? edge.target : edge.source;
      let marker: 'cycle' | 'repeated' | undefined;
      if (path.includes(nextNodeId)) marker = 'cycle';
      else if (emittedNodes.has(nextNodeId)) marker = 'repeated';

      includedEdges[edge.id] = marker ? { ...clone(edge), marker } : clone(edge);
      includedNodes[nextNodeId] = clone(nodes[nextNodeId]);
      if (marker) {
        markers.push({ edgeId: edge.id, source: edge.source, target: edge.target, marker });
      } else {
        visit(nextNodeId, depth + 1, [...path, nextNodeId]);
      }
    }
  };

  visit(startNodeId, 0, [startNodeId]);
  return {
    type: 'subtree',
    documentId: document.metadata.id,
    graphVersion: document.metadata.graphVersion,
    rootNodeId: startNodeId,
    direction,
    maxDepth,
    nodes: includedNodes,
    edges: includedEdges,
    includedNodeIds: Object.keys(includedNodes).sort(),
    includedEdgeIds: sortedEdges(includedEdges).map((edge) => edge.id),
    markers,
    omissions: { maxDepthReached: maxDepth },
  };
}

export function fullProjection(document: GraphDocument, maxNodes?: number, maxEdges?: number): GraphProjection {
  validateDocument(document);
  let nodeIds = Object.keys(document.graph.nodes).sort();
  const edgeValues = sortedEdges(document.graph.edges);
  let omittedNodeCount = 0;
  let omittedEdgeCount = 0;
  if (maxNodes !== undefined && nodeIds.length > maxNodes) {
    omittedNodeCount = nodeIds.length - maxNodes;
    nodeIds = nodeIds.slice(0, maxNodes);
  }
  const nodeSet = new Set(nodeIds);
  let filteredEdges = edgeValues.filter((edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target));
  if (maxEdges !== undefined && filteredEdges.length > maxEdges) {
    omittedEdgeCount = filteredEdges.length - maxEdges;
    filteredEdges = filteredEdges.slice(0, maxEdges);
  }
  return {
    type: 'full',
    documentId: document.metadata.id,
    graphVersion: document.metadata.graphVersion,
    rootNodeId: document.graph.entryNodeId,
    nodes: Object.fromEntries(nodeIds.map((nodeId) => [nodeId, clone(document.graph.nodes[nodeId])])),
    edges: Object.fromEntries(filteredEdges.map((edge) => [edge.id, clone(edge)])),
    includedNodeIds: nodeIds,
    includedEdgeIds: filteredEdges.map((edge) => edge.id),
    markers: [],
    omissions: { omittedNodeCount, omittedEdgeCount },
  };
}

export function selectionProjection(
  document: GraphDocument,
  nodeIds: Array<string>,
  edgeIds: Array<string> = [],
): GraphProjection {
  validateDocument(document);
  const orderedNodeIds = [...new Set(nodeIds)];
  const orderedEdgeIds = [...new Set(edgeIds)];
  const unknownNodeIds = orderedNodeIds.filter((nodeId) => !document.graph.nodes[nodeId]).sort();
  const unknownEdgeIds = orderedEdgeIds.filter((edgeId) => !document.graph.edges[edgeId]).sort();
  if (unknownNodeIds.length > 0 || unknownEdgeIds.length > 0) {
    throw new ToolInputError('Selection references nodes or edges outside the canonical graph.', {
      nodeIds: unknownNodeIds,
      edgeIds: unknownEdgeIds,
    });
  }

  const includedNodeIds = new Set(orderedNodeIds);
  const includedEdges: Record<string, GraphEdge> = {};
  for (const edgeId of orderedEdgeIds) {
    const edge = document.graph.edges[edgeId];
    includedEdges[edgeId] = clone(edge);
    includedNodeIds.add(edge.source);
    includedNodeIds.add(edge.target);
  }
  const selectedNodeSet = new Set(orderedNodeIds);
  for (const edge of sortedEdges(document.graph.edges)) {
    if (selectedNodeSet.has(edge.source) && selectedNodeSet.has(edge.target)) {
      includedEdges[edge.id] = clone(edge);
    }
  }
  const sortedNodeIds = [...includedNodeIds].sort();
  return {
    type: 'selection',
    documentId: document.metadata.id,
    graphVersion: document.metadata.graphVersion,
    rootNodeId: sortedNodeIds[0] ?? null,
    nodes: Object.fromEntries(sortedNodeIds.map((nodeId) => [nodeId, clone(document.graph.nodes[nodeId])])),
    edges: includedEdges,
    includedNodeIds: sortedNodeIds,
    includedEdgeIds: sortedEdges(includedEdges).map((edge) => edge.id),
    markers: [],
    omissions: {
      reason: null,
      selectedNodeCount: orderedNodeIds.length,
      selectedEdgeCount: orderedEdgeIds.length,
    },
  };
}

function edgeSort(left: GraphEdge, right: GraphEdge): number {
  return (
    [
      left.kind.localeCompare(right.kind),
      (left.order ?? 1_000_000_000) - (right.order ?? 1_000_000_000),
      left.id.localeCompare(right.id),
      left.target.localeCompare(right.target),
      left.source.localeCompare(right.source),
    ].find((value) => value !== 0) ?? 0
  );
}

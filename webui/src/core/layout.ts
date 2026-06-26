import { type GraphDocument, type GraphNode, sortedEdges, validateDocument } from './graph.js';

export type ViewState = {
  documentId: string;
  viewId: string;
  positions: Record<string, { x: number; y: number }>;
  dimensions?: Record<string, { width: number; height: number }>;
  collapsed?: Array<string>;
  viewport: { x: number; y: number; zoom: number };
  updatedAt: string | null;
};

export type ReactFlowProjection = {
  ok: true;
  documentId: string;
  graphVersion: number;
  nodes: Array<Record<string, unknown> & { id: string; position: { x: number; y: number } }>;
  edges: Array<Record<string, unknown> & { id: string; source: string; target: string }>;
  viewport: { x: number; y: number; zoom: number };
};

export function defaultViewState(documentId: string): ViewState {
  return {
    documentId,
    viewId: 'webui-default',
    positions: {},
    collapsed: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    updatedAt: null,
  };
}

export function estimateDimensions(node: GraphNode): { width: number; height: number } {
  const cardContent = node.cardContent ?? '';
  const longestText = Math.max(node.title.length, ...cardContent.split(/\s+/).map((word) => word.length), 0);
  const width = Math.max(220, Math.min(360, Math.max(node.title.length * 9 + 44, longestText * 9.5 + 44)));
  const textWidth = width - 20;
  const titleLines = estimateWrappedLines(node.title, Math.max(10, Math.floor(textWidth / 9.8)));
  const cardLines = estimateWrappedLines(cardContent || 'No card content', Math.max(14, Math.floor(textWidth / 7.8)));
  const verticalPadding = 16;
  const gap = 5;
  const titleHeight = Math.max(25, titleLines * 21 + 4);
  const cardHeight = Math.max(58, cardLines * 18 + 4);
  const measurementSafety = 12;
  return { width, height: verticalPadding + titleHeight + gap + cardHeight + measurementSafety };
}

function estimateWrappedLines(value: string, charactersPerLine: number): number {
  const lines = value.split(/\r?\n/);
  return Math.max(
    1,
    lines.reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0),
  );
}

export function calculatePositions(document: GraphDocument): Record<string, { x: number; y: number }> {
  validateDocument(document);
  const positions: Record<string, { x: number; y: number }> = {};
  const children: Record<string, Array<string>> = {};
  for (const edge of sortedEdges(document.graph.edges)) {
    if (edge.kind === 'contains') {
      children[edge.source] = [...(children[edge.source] ?? []), edge.target];
    }
  }

  const visited = new Set<string>();
  let y = 0;
  const place = (nodeId: string, depth: number): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    positions[nodeId] = { x: depth * 300, y };
    y += estimateDimensions(document.graph.nodes[nodeId]).height + 44;
    for (const childId of children[nodeId] ?? []) {
      place(childId, depth + 1);
    }
  };

  place(document.graph.entryNodeId, 0);
  for (const nodeId of Object.keys(document.graph.nodes).sort()) {
    place(nodeId, 0);
  }
  return positions;
}

export function toReactFlowView(document: GraphDocument, viewState?: Partial<ViewState> | null): ReactFlowProjection {
  validateDocument(document);
  const state = viewState ?? {};
  const positions = { ...calculatePositions(document), ...(state.positions ?? {}) };
  const dimensions = state.dimensions ?? {};
  const collapsed = new Set(state.collapsed ?? []);
  const hiddenNodes = new Set<string>();
  for (const edge of sortedEdges(document.graph.edges)) {
    if (collapsed.has(edge.source) && edge.kind === 'contains') {
      hiddenNodes.add(edge.target);
    }
  }

  const nodes = Object.keys(document.graph.nodes)
    .sort()
    .filter((nodeId) => !hiddenNodes.has(nodeId))
    .map((nodeId) => {
      const node = document.graph.nodes[nodeId];
      const minimumSize = estimateDimensions(node);
      const savedSize = dimensions[nodeId];
      const size = savedSize
        ? {
            width: Math.max(savedSize.width, minimumSize.width),
            height: Math.max(savedSize.height, minimumSize.height),
          }
        : minimumSize;
      return {
        id: nodeId,
        type: 'topicCard',
        position: positions[nodeId],
        data: {
          nodeId,
          title: node.title,
          cardContent: node.cardContent ?? '',
          notes: node.notes ?? '',
          meta: node.meta ?? {},
          diagramKind: document.graph.diagramKind,
        },
        ...size,
      };
    });

  const edges = sortedEdges(document.graph.edges)
    .filter((edge) => !hiddenNodes.has(edge.source) && !hiddenNodes.has(edge.target))
    .map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.kind === 'contains' ? 'smoothstep' : 'dashedReference',
      label: edge.kind ?? 'contains',
      data: {
        edgeId: edge.id,
        kind: edge.kind ?? 'contains',
        order: edge.order,
        meta: edge.meta ?? {},
      },
    }));

  return {
    ok: true,
    documentId: document.metadata.id,
    graphVersion: document.metadata.graphVersion,
    nodes,
    edges,
    viewport: state.viewport ?? { x: 0, y: 0, zoom: 1 },
  };
}

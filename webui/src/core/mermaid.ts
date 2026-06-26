import { type GraphDocument, type GraphEdge, sortedEdges, validateDocument } from './graph.js';
import { extractSubtree, fullProjection, type GraphProjection } from './projections.js';

export function sanitizeIdentifier(value: string): string {
  let sanitized = value.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!sanitized) sanitized = 'id';
  if (/^\d/.test(sanitized)) sanitized = `id_${sanitized}`;
  return `n_${sanitized}`;
}

export function escapeLabel(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').split(/\r?\n/).join(' ').trim();
}

export function uniqueMermaidIds(nodeIds: Array<string>): Record<string, string> {
  const result: Record<string, string> = {};
  const used: Record<string, number> = {};
  for (const nodeId of nodeIds) {
    const base = sanitizeIdentifier(nodeId);
    const count = used[base] ?? 0;
    used[base] = count + 1;
    result[nodeId] = count === 0 ? base : `${base}_${count}`;
  }
  return result;
}

export function compileProjectionToMermaid(
  projection: GraphProjection,
  options: {
    orientation?: 'LR' | 'TD' | string;
    includeEdgeKinds?: boolean;
    includeNodeContent?: 'none' | 'card' | 'notes' | string;
  } = {},
): {
  mermaid: string;
  includedNodeIds: Array<string>;
  includedEdgeIds: Array<string>;
  projectionSupport: {
    nodes: Record<string, { nodeId: string }>;
    edges: Record<string, { edgeId: string; source: string; target: string; kind: string; order?: number; marker?: string }>;
    markers: GraphProjection['markers'];
    scope: {
      type: GraphProjection['type'];
      rootNodeId: string | null;
      direction?: string;
      maxDepth?: number;
    };
    omissions: Record<string, unknown>;
  };
  nodeContent: Record<string, Record<string, unknown>>;
} {
  const orientation = options.orientation === 'TD' ? 'TD' : 'LR';
  const includeEdgeKinds = options.includeEdgeKinds ?? true;
  const includeNodeContent = options.includeNodeContent ?? 'card';
  const nodeIds = Object.keys(projection.nodes).sort();
  const mermaidIds = uniqueMermaidIds(nodeIds);
  const lines = [`flowchart ${orientation}`];
  const projectionNodes: Record<string, { nodeId: string }> = {};

  for (const nodeId of nodeIds) {
    const mermaidId = mermaidIds[nodeId];
    lines.push(`  ${mermaidId}["${escapeLabel(projection.nodes[nodeId].title)}"]`);
    projectionNodes[mermaidId] = { nodeId };
  }

  const edgeValues = sortedEdges(projection.edges) as Array<GraphEdge & { marker?: 'cycle' | 'repeated' }>;
  if (edgeValues.length > 0) lines.push('');

  const projectionEdges: ReturnType<typeof compileProjectionToMermaid>['projectionSupport']['edges'] = {};
  edgeValues.forEach((edge, index) => {
    const label = edgeLabel(edge, includeEdgeKinds);
    const source = mermaidIds[edge.source];
    const target = mermaidIds[edge.target];
    lines.push(label ? `  ${source} -->|"${escapeLabel(label)}"| ${target}` : `  ${source} --> ${target}`);
    const projectionEdgeId = `p_${index}_${edge.id.replace(/[^A-Za-z0-9_]/g, '_')}`;
    projectionEdges[projectionEdgeId] = {
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      kind: edge.kind ?? 'contains',
      ...(edge.order !== undefined ? { order: edge.order } : {}),
      ...(edge.marker ? { marker: edge.marker } : {}),
    };
  });

  const nodeContent: Record<string, Record<string, unknown>> = {};
  for (const nodeId of nodeIds) {
    const node = projection.nodes[nodeId];
    const content: Record<string, unknown> = { title: node.title };
    if (includeNodeContent === 'card' || includeNodeContent === 'notes') {
      content.cardContent = node.cardContent ?? '';
    }
    if (includeNodeContent === 'notes') {
      content.notes = node.notes ?? '';
    } else if (node.notes) {
      content.notesOmitted = true;
    }
    nodeContent[nodeId] = content;
  }

  return {
    mermaid: lines.join('\n'),
    includedNodeIds: projection.includedNodeIds,
    includedEdgeIds: projection.includedEdgeIds,
    projectionSupport: {
      nodes: projectionNodes,
      edges: projectionEdges,
      markers: projection.markers,
      scope: {
        type: projection.type,
        rootNodeId: projection.rootNodeId,
        direction: projection.direction,
        maxDepth: projection.maxDepth,
      },
      omissions: projection.omissions,
    },
    nodeContent,
  };
}

export function compileDocumentToMermaidContext(
  document: GraphDocument,
  options: {
    startNodeId?: string;
    direction?: 'outgoing' | 'incoming' | 'both';
    maxDepth?: number;
    orientation?: 'LR' | 'TD' | string;
    includeEdgeKinds?: boolean;
    includeNodeContent?: 'none' | 'card' | 'notes' | string;
    maxNodes?: number;
    maxEdges?: number;
  } = {},
): Record<string, unknown> {
  validateDocument(document);
  const projection = options.startNodeId
    ? extractSubtree(document, options.startNodeId, options.direction ?? 'outgoing', options.maxDepth ?? 3)
    : fullProjection(document, options.maxNodes, options.maxEdges);
  return {
    ok: true,
    documentId: document.metadata.id,
    graphVersion: document.metadata.graphVersion,
    ...compileProjectionToMermaid(projection, options),
  };
}

function edgeLabel(edge: { kind?: string; order?: number; marker?: string }, includeEdgeKinds: boolean): string {
  const parts: Array<string> = [];
  if (includeEdgeKinds) parts.push(edge.kind ?? 'contains');
  if (edge.order !== undefined) parts.push(`order=${edge.order}`);
  if (edge.marker) parts.push(edge.marker);
  return parts.join(' ');
}

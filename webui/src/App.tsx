import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  SelectionMode,
  Handle,
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type Viewport,
  type OnSelectionChangeParams,
  type NodeProps,
} from '@xyflow/react';
import { AlertCircle, CheckCircle2, MousePointer2 } from 'lucide-react';

type TopicNodeData = {
  nodeId: string;
  title: string;
  cardContent?: string;
  notes?: string;
  diagramKind?: string;
};

type GraphPayload = {
  ok: boolean;
  documentId: string;
  graphVersion: number;
  nodes: Array<Node<TopicNodeData>>;
  edges: Array<Edge>;
  viewport: Viewport;
  hasViewState: boolean;
  viewStateUpdatedAt: string | null;
};

type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

function TopicCardNode({ data, selected }: NodeProps<Node<TopicNodeData>>) {
  return (
    <article className={`topic-card-node ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <h2>{data.title}</h2>
      {data.cardContent ? <p>{data.cardContent}</p> : <p className="muted">No card content</p>}
      <Handle type="source" position={Position.Right} />
    </article>
  );
}

function tokenFromLocation(): string {
  return new URLSearchParams(window.location.search).get('token') ?? '';
}

async function fetchGraph(token: string): Promise<GraphPayload> {
  const response = await fetch('/api/graph', {
    headers: token ? { 'X-Mindmap-Token': token } : {},
  });
  const payload = (await response.json()) as GraphPayload | ApiError;
  if (!response.ok || !payload.ok) {
    const message = 'error' in payload ? payload.error.message : 'Unable to load graph.';
    throw new Error(message);
  }
  return payload;
}

async function syncSelection(
  token: string,
  graphVersion: number,
  nodeIds: Array<string>,
  edgeIds: Array<string>,
): Promise<void> {
  const response = await fetch('/api/selection', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Mindmap-Token': token } : {}),
    },
    body: JSON.stringify({ graphVersion, nodeIds, edgeIds }),
  });
  const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message ?? 'Unable to sync selection.');
  }
}

async function syncViewState(
  token: string,
  graphVersion: number,
  payload: { positions?: Record<string, { x: number; y: number }>; viewport?: Viewport },
): Promise<void> {
  const response = await fetch('/api/view-state', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Mindmap-Token': token } : {}),
    },
    body: JSON.stringify({ graphVersion, ...payload }),
  });
  const responsePayload = (await response.json()) as { ok: boolean; error?: { message: string } };
  if (!response.ok || !responsePayload.ok) {
    throw new Error(responsePayload.error?.message ?? 'Unable to sync view state.');
  }
}

function prepareNodes(nodes: Array<Node<TopicNodeData>>): Array<Node<TopicNodeData>> {
  return nodes.map((node) => ({
    ...node,
    selectable: true,
    draggable: true,
    style: {
      width: node.width,
      minHeight: node.height,
    },
  }));
}

export function App() {
  const [nodes, setNodes] = useState<Array<Node<TopicNodeData>>>([]);
  const [edges, setEdges] = useState<Array<Edge>>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Array<string>>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<Array<string>>([]);
  const [documentId, setDocumentId] = useState('');
  const [graphVersion, setGraphVersion] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectionStatus, setSelectionStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
  const [viewStateStatus, setViewStateStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [initialViewport, setInitialViewport] = useState<Viewport | undefined>(undefined);
  const [hasStoredViewState, setHasStoredViewState] = useState(false);
  const [error, setError] = useState('');
  const selectionRevision = useRef(0);
  const viewStateRevision = useRef(0);
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const token = useMemo(tokenFromLocation, []);
  const nodeTypes = useMemo(() => ({ topicCard: TopicCardNode }), []);

  useEffect(() => {
    fetchGraph(token)
      .then((payload) => {
        setNodes(prepareNodes(payload.nodes));
        setEdges(payload.edges);
        setDocumentId(payload.documentId);
        setGraphVersion(payload.graphVersion);
        setInitialViewport(payload.viewport);
        setHasStoredViewState(payload.hasViewState);
        setStatus('ready');
      })
      .catch((loadError: Error) => {
        setError(loadError.message);
        setStatus('error');
      });
  }, [token]);

  useEffect(() => {
    positionsRef.current = Object.fromEntries(nodes.map((node) => [node.id, node.position]));
  }, [nodes]);

  const persistViewState = useCallback((
    viewState: { positions?: Record<string, { x: number; y: number }>; viewport?: Viewport },
  ) => {
    if (graphVersion === null) {
      return;
    }
    const revision = viewStateRevision.current + 1;
    viewStateRevision.current = revision;
    setViewStateStatus('saving');
    syncViewState(token, graphVersion, viewState)
      .then(() => {
        if (viewStateRevision.current === revision) {
          setViewStateStatus('saved');
          setHasStoredViewState(true);
        }
      })
      .catch(() => {
        if (viewStateRevision.current === revision) {
          setViewStateStatus('error');
        }
      });
  }, [graphVersion, token]);

  const onNodesChange = useCallback((changes: Array<NodeChange<Node<TopicNodeData>>>) => {
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
  }, []);

  const onEdgesChange = useCallback((changes: Array<EdgeChange<Edge>>) => {
    setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
  }, []);

  const onSelectionChange = useCallback((selection: OnSelectionChangeParams<Node<TopicNodeData>, Edge>) => {
    const nodeIds = selection.nodes.map((node) => node.id);
    const edgeIds = selection.edges.map((edge) => edge.id);
    setSelectedNodeIds(nodeIds);
    setSelectedEdgeIds(edgeIds);
    if (graphVersion === null) {
      return;
    }
    const revision = selectionRevision.current + 1;
    selectionRevision.current = revision;
    setSelectionStatus('syncing');
    syncSelection(token, graphVersion, nodeIds, edgeIds)
      .then(() => {
        if (selectionRevision.current === revision) {
          setSelectionStatus('synced');
        }
      })
      .catch(() => {
        if (selectionRevision.current === revision) {
          setSelectionStatus('error');
        }
      });
  }, [graphVersion, token]);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node<TopicNodeData>) => {
    persistViewState({
      positions: {
        ...positionsRef.current,
        [node.id]: node.position,
      },
    });
  }, [persistViewState]);

  const onMoveEnd = useCallback((event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    if (event === null) {
      return;
    }
    persistViewState({ viewport });
  }, [persistViewState]);

  const selectionText = useMemo(() => {
    const base = `Selected ${selectedNodeIds.length} nodes.`;
    if (selectedNodeIds.length === 0) {
      return base;
    }
    if (selectionStatus === 'syncing') {
      return `${base} Syncing selection for Codex context.`;
    }
    if (selectionStatus === 'synced') {
      return `${base} Ready for Codex context.`;
    }
    if (selectionStatus === 'error') {
      return `${base} Selection is not synced to Codex context.`;
    }
    return base;
  }, [selectedNodeIds.length, selectionStatus]);

  const viewStateText = useMemo(() => {
    if (viewStateStatus === 'saving') {
      return 'Saving display state.';
    }
    if (viewStateStatus === 'saved') {
      return 'Display state saved outside canonical JSON.';
    }
    if (viewStateStatus === 'error') {
      return 'Display state was not saved.';
    }
    return hasStoredViewState ? 'Display state loaded outside canonical JSON.' : 'Canonical JSON remains the graph source.';
  }, [hasStoredViewState, viewStateStatus]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Mind Map</h1>
          <p>{documentId ? `${documentId} · graphVersion ${graphVersion}` : 'Loading projection'}</p>
        </div>
        <div className={`status-pill ${status}`}>
          {status === 'ready' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{status === 'ready' ? 'Projection only' : status}</span>
        </div>
      </header>

      <section className="workspace" aria-label="Mind map ReactFlow canvas">
        {status === 'error' ? (
          <div className="error-state" role="alert">
            <AlertCircle size={28} />
            <h2>Unable to load graph</h2>
            <p>{error}</p>
          </div>
        ) : (
          <ReactFlow
            key={`${documentId}-${graphVersion}-${hasStoredViewState ? 'stored-view' : 'projection-view'}`}
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={onSelectionChange}
            onNodeDragStop={onNodeDragStop}
            onMoveEnd={onMoveEnd}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            panOnDrag={false}
            panOnScroll
            fitView={!hasStoredViewState}
            defaultViewport={initialViewport}
            minZoom={0.2}
            maxZoom={1.8}
          >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        )}
      </section>

      <footer className="selection-bar" aria-label="Current selection">
        <div className="selection-summary">
          <MousePointer2 size={16} />
          <span>{selectionText}</span>
          {selectedEdgeIds.length > 0 ? <span className="edge-selection">{selectedEdgeIds.length} edges selected.</span> : null}
          <span className={`view-state-status ${viewStateStatus}`}>{viewStateText}</span>
        </div>
      </footer>
    </main>
  );
}

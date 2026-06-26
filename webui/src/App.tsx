import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

type NodeTextPatch = {
  title?: string;
  cardContent?: string;
};

type TopicNodeData = {
  nodeId: string;
  title: string;
  cardContent?: string;
  notes?: string;
  diagramKind?: string;
  onCommitText?: (nodeId: string, patch: NodeTextPatch) => Promise<void>;
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

type ApplyOperationsPayload = {
  ok: true;
  documentId: string;
  graphVersion: number;
  graph: GraphPayload;
};

const TopicCardNode = memo(function TopicCardNode({ data, selected }: NodeProps<Node<TopicNodeData>>) {
  const [title, setTitle] = useState(data.title);
  const [cardContent, setCardContent] = useState(data.cardContent ?? '');
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const cardContentRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setTitle(data.title);
    setCardContent(data.cardContent ?? '');
  }, [data.title, data.cardContent]);

  useEffect(() => {
    resizeTextareaToContent(titleRef.current);
  }, [title]);

  useEffect(() => {
    resizeTextareaToContent(cardContentRef.current);
  }, [cardContent]);

  const commitTitle = useCallback(async () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setTitle(data.title);
      return;
    }
    if (nextTitle === data.title || !data.onCommitText) {
      setTitle(nextTitle);
      return;
    }
    try {
      await data.onCommitText(data.nodeId, { title: nextTitle });
      setTitle(nextTitle);
    } catch {
      setTitle(data.title);
    }
  }, [data, title]);

  const commitCardContent = useCallback(async () => {
    const original = data.cardContent ?? '';
    const nextCardContent = cardContent.trim();
    if (nextCardContent === original || !data.onCommitText) {
      setCardContent(nextCardContent);
      return;
    }
    try {
      await data.onCommitText(data.nodeId, { cardContent: nextCardContent });
      setCardContent(nextCardContent);
    } catch {
      setCardContent(original);
    }
  }, [cardContent, data]);

  const titleRows = useMemo(() => estimatedRows(title, 24, 1), [title]);
  const contentRows = useMemo(() => estimatedRows(cardContent || 'No card content', 30, 3), [cardContent]);

  const onTitleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      setTitle(data.title);
      event.currentTarget.blur();
    }
  }, [data.title]);

  const onCardKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      setCardContent(data.cardContent ?? '');
      event.currentTarget.blur();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }, [data.cardContent]);

  return (
    <article className={`topic-card-node ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <textarea
        ref={titleRef}
        aria-label={`Edit title for ${data.nodeId}`}
        className="topic-title-input nodrag nowheel"
        value={title}
        rows={titleRows}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => {
          void commitTitle();
        }}
        onKeyDown={onTitleKeyDown}
      />
      <textarea
        ref={cardContentRef}
        aria-label={`Edit content for ${data.nodeId}`}
        className="topic-content-input nodrag nowheel"
        value={cardContent}
        placeholder="No card content"
        rows={contentRows}
        onChange={(event) => setCardContent(event.target.value)}
        onBlur={() => {
          void commitCardContent();
        }}
        onKeyDown={onCardKeyDown}
      />
      <Handle type="source" position={Position.Right} />
    </article>
  );
});

function resizeTextareaToContent(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) {
    return;
  }
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight + 2}px`;
}

function estimatedRows(value: string, charactersPerLine: number, minRows: number): number {
  const lines = value.split(/\r?\n/);
  const rows = lines.reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
  return Math.max(minRows, rows);
}

async function fetchGraph(): Promise<GraphPayload> {
  const response = await fetch('/api/graph');
  const payload = (await response.json()) as GraphPayload | ApiError;
  if (!response.ok || !payload.ok) {
    const message = 'error' in payload ? payload.error.message : 'Unable to load graph.';
    throw new Error(message);
  }
  return payload;
}

async function syncSelection(
  graphVersion: number,
  nodeIds: Array<string>,
  edgeIds: Array<string>,
): Promise<void> {
  const response = await fetch('/api/selection', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ graphVersion, nodeIds, edgeIds }),
  });
  const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error?.message ?? 'Unable to sync selection.');
  }
}

async function syncViewState(
  graphVersion: number,
  payload: { positions?: Record<string, { x: number; y: number }>; viewport?: Viewport },
): Promise<void> {
  const response = await fetch('/api/view-state', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ graphVersion, ...payload }),
  });
  const responsePayload = (await response.json()) as { ok: boolean; error?: { message: string } };
  if (!response.ok || !responsePayload.ok) {
    throw new Error(responsePayload.error?.message ?? 'Unable to sync view state.');
  }
}

async function applyNodeTextPatch(
  documentId: string,
  graphVersion: number,
  nodeId: string,
  patch: NodeTextPatch,
): Promise<ApplyOperationsPayload> {
  const response = await fetch('/api/operations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      documentId,
      baseGraphVersion: graphVersion,
      operations: [{ type: 'updateNode', nodeId, patch }],
    }),
  });
  const payload = (await response.json()) as ApplyOperationsPayload | ApiError;
  if (!response.ok || !payload.ok) {
    const message = 'error' in payload ? payload.error.message : 'Unable to save text edit.';
    throw new Error(message);
  }
  return payload;
}

function prepareNodes(
  nodes: Array<Node<TopicNodeData>>,
  onCommitText: (nodeId: string, patch: NodeTextPatch) => Promise<void>,
): Array<Node<TopicNodeData>> {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      onCommitText,
    },
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
  const [editStatus, setEditStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [initialViewport, setInitialViewport] = useState<Viewport | undefined>(undefined);
  const [hasStoredViewState, setHasStoredViewState] = useState(false);
  const [error, setError] = useState('');
  const selectionRevision = useRef(0);
  const viewStateRevision = useRef(0);
  const editRevision = useRef(0);
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const documentIdRef = useRef('');
  const graphVersionRef = useRef<number | null>(null);
  const nodeTypes = useMemo(() => ({ topicCard: TopicCardNode }), []);

  const commitNodeText = useCallback(async (nodeId: string, patch: NodeTextPatch) => {
    const currentDocumentId = documentIdRef.current;
    const currentGraphVersion = graphVersionRef.current;
    if (!currentDocumentId || currentGraphVersion === null) {
      throw new Error('Graph is not ready for editing.');
    }
    const revision = editRevision.current + 1;
    editRevision.current = revision;
    setEditStatus('saving');
    try {
      const payload = await applyNodeTextPatch(currentDocumentId, currentGraphVersion, nodeId, patch);
      documentIdRef.current = payload.documentId;
      graphVersionRef.current = payload.graphVersion;
      setNodes(prepareNodes(payload.graph.nodes, commitNodeText));
      setEdges(payload.graph.edges);
      setDocumentId(payload.documentId);
      setGraphVersion(payload.graphVersion);
      setInitialViewport(payload.graph.viewport);
      setHasStoredViewState(payload.graph.hasViewState);
      if (editRevision.current === revision) {
        setEditStatus('saved');
      }
    } catch (saveError) {
      if (editRevision.current === revision) {
        setEditStatus('error');
      }
      throw saveError;
    }
  }, []);

  useEffect(() => {
    fetchGraph()
      .then((payload) => {
        documentIdRef.current = payload.documentId;
        graphVersionRef.current = payload.graphVersion;
        setNodes(prepareNodes(payload.nodes, commitNodeText));
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
  }, [commitNodeText]);

  useEffect(() => {
    documentIdRef.current = documentId;
    graphVersionRef.current = graphVersion;
  }, [documentId, graphVersion]);

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
    syncViewState(graphVersion, viewState)
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
  }, [graphVersion]);

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
    syncSelection(graphVersion, nodeIds, edgeIds)
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
  }, [graphVersion]);

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

  const editText = useMemo(() => {
    if (editStatus === 'saving') {
      return 'Saving text edit.';
    }
    if (editStatus === 'saved') {
      return 'Text edit saved to canonical JSON.';
    }
    if (editStatus === 'error') {
      return 'Text edit was not saved.';
    }
    return 'Text editing enabled.';
  }, [editStatus]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Mind Map</h1>
          <p>{documentId ? `${documentId} · graphVersion ${graphVersion}` : 'Loading projection'}</p>
        </div>
        <div className={`status-pill ${status}`}>
          {status === 'ready' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{status === 'ready' ? 'Editing enabled' : status}</span>
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
          <span className={`edit-status ${editStatus}`}>{editText}</span>
          <span className={`view-state-status ${viewStateStatus}`}>{viewStateText}</span>
        </div>
      </footer>
    </main>
  );
}

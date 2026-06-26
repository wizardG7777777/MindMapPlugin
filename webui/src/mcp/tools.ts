import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

import { MindMapError, ToolInputError } from '../core/errors.js';
import {
  applyOperations,
  getNeighbors,
  getNode,
  previewOperations,
  summarizeDocument,
  type GraphDocument,
  type OperationEnvelope,
  validateDocument,
} from '../core/graph.js';
import { toReactFlowView } from '../core/layout.js';
import { compileDocumentToMermaidContext, compileProjectionToMermaid } from '../core/mermaid.js';
import { extractSubtree, selectionProjection } from '../core/projections.js';
import { DEFAULT_RUNTIME_PATH, loadDocument, readViewState, writeDocument } from '../server/service.js';

export type ToolArguments = Record<string, unknown>;
export type ToolHandler = (arguments_: ToolArguments) => Promise<Record<string, unknown>> | Record<string, unknown>;

export async function callTool(name: string, arguments_: ToolArguments): Promise<Record<string, unknown>> {
  const handler = toolRegistry[name];
  if (!handler) throw new ToolInputError(`Unknown tool: ${name}`);
  return handler(arguments_);
}

export async function toolGetDocumentSummary(arguments_: ToolArguments): Promise<Record<string, unknown>> {
  const document = await documentFromArguments(arguments_);
  return { ok: true, ...summarizeDocument(document) };
}

export async function toolGetNode(arguments_: ToolArguments): Promise<Record<string, unknown>> {
  const document = await documentFromArguments(arguments_);
  return { ok: true, node: getNode(document, stringArgument(arguments_, 'nodeId')) };
}

export async function toolGetNeighbors(arguments_: ToolArguments): Promise<Record<string, unknown>> {
  const document = await documentFromArguments(arguments_);
  return {
    ok: true,
    ...getNeighbors(
      document,
      stringArgument(arguments_, 'nodeId'),
      enumArgument(arguments_, 'direction', ['incoming', 'outgoing', 'both'], 'both'),
    ),
  };
}

export async function toolExtractSubtree(arguments_: ToolArguments): Promise<Record<string, unknown>> {
  const document = await documentFromArguments(arguments_);
  return {
    ok: true,
    projection: extractSubtree(
      document,
      stringArgument(arguments_, 'startNodeId'),
      enumArgument(arguments_, 'direction', ['incoming', 'outgoing', 'both'], 'outgoing'),
      numberArgument(arguments_, 'maxDepth', 3),
      stringArgument(arguments_, 'cyclePolicy', 'mark'),
    ),
  };
}

export async function toolCompileMermaidContext(arguments_: ToolArguments): Promise<Record<string, unknown>> {
  const document = await documentFromArguments(arguments_);
  return compileDocumentToMermaidContext(document, {
    startNodeId: optionalStringArgument(arguments_, 'startNodeId'),
    direction: enumArgument(arguments_, 'direction', ['incoming', 'outgoing', 'both'], 'outgoing'),
    maxDepth: numberArgument(arguments_, 'maxDepth', 3),
    orientation: enumArgument(arguments_, 'orientation', ['LR', 'TD'], 'LR'),
    includeEdgeKinds: booleanArgument(arguments_, 'includeEdgeKinds', true),
    includeNodeContent: enumArgument(arguments_, 'includeNodeContent', ['none', 'card', 'notes'], 'card'),
    maxNodes: optionalNumberArgument(arguments_, 'maxNodes'),
    maxEdges: optionalNumberArgument(arguments_, 'maxEdges'),
  });
}

export async function toolPreviewOperations(arguments_: ToolArguments): Promise<Record<string, unknown>> {
  const document = await documentFromArguments(arguments_);
  return previewOperations(document, objectArgument(arguments_, 'operationEnvelope') as OperationEnvelope);
}

export async function toolApplyOperations(arguments_: ToolArguments): Promise<Record<string, unknown>> {
  const documentPath = stringArgument(arguments_, 'documentPath');
  const document = await documentFromArguments(arguments_);
  const envelope = objectArgument(arguments_, 'operationEnvelope') as OperationEnvelope;
  const { document: updated, result } = applyOperations(document, envelope);
  const outputPath = optionalStringArgument(arguments_, 'outputPath') ?? documentPath;
  await writeDocument(outputPath, updated);
  return { ...result, outputPath };
}

export async function toolRenderReactflowView(arguments_: ToolArguments): Promise<Record<string, unknown>> {
  const document = await documentFromArguments(arguments_);
  const viewStatePath = optionalStringArgument(arguments_, 'viewStatePath');
  const viewState = viewStatePath ? JSON.parse(await fs.readFile(viewStatePath, 'utf8')) : undefined;
  return toReactFlowView(document, viewState);
}

export async function toolGetCurrentSelection(arguments_: ToolArguments): Promise<Record<string, unknown>> {
  const document = await documentFromArguments(arguments_);
  const selection = await fetchWebUISelection(arguments_);
  assertSelectionMatchesDocument(selection, document, optionalStringArgument(arguments_, 'documentPath'));
  const nodeCount = selection.nodeIds.length;
  const edgeCount = selection.edgeIds.length;
  return {
    ok: true,
    documentId: selection.documentId,
    documentPath: selection.documentPath,
    graphVersion: selection.graphVersion,
    nodeIds: selection.nodeIds,
    edgeIds: selection.edgeIds,
    nodeCount,
    edgeCount,
    updatedAt: selection.updatedAt,
    stale: selection.stale,
    promptHint: `The user selected ${nodeCount} node${nodeCount !== 1 ? 's' : ''} in the WebUI.`,
    source: { type: 'webui_selection' },
  };
}

export async function toolBuildContextFromSelection(arguments_: ToolArguments): Promise<Record<string, unknown>> {
  const documentPath = stringArgument(arguments_, 'documentPath');
  const document = await documentFromArguments(arguments_);
  const selection = await fetchWebUISelection(arguments_);
  assertSelectionMatchesDocument(selection, document, documentPath);
  const projection = selectionProjection(document, selection.nodeIds, selection.edgeIds);
  const compiled = compileProjectionToMermaid(projection, {
    orientation: enumArgument(arguments_, 'orientation', ['LR', 'TD'], 'LR'),
    includeEdgeKinds: booleanArgument(arguments_, 'includeEdgeKinds', true),
    includeNodeContent: enumArgument(arguments_, 'includeNodeContent', ['none', 'card', 'notes'], 'card'),
  });
  const nodeCount = selection.nodeIds.length;
  const edgeCount = selection.edgeIds.length;
  return {
    ok: true,
    contextId: 'ctx_webui_selection',
    purpose: stringArgument(arguments_, 'purpose', 'webui_selection_context'),
    documentId: document.metadata.id,
    documentPath: resolve(documentPath),
    graphVersion: document.metadata.graphVersion,
    source: {
      type: 'webui_selection',
      updatedAt: selection.updatedAt,
      stale: selection.stale,
    },
    promptHint: `The user selected ${nodeCount} node${nodeCount !== 1 ? 's' : ''} in the WebUI.`,
    scope: {
      type: 'selection',
      nodeIds: selection.nodeIds,
      edgeIds: selection.edgeIds,
      nodeCount,
      edgeCount,
    },
    graph: {
      nodeIds: compiled.includedNodeIds,
      edgeIds: compiled.includedEdgeIds,
    },
    includedNodeIds: compiled.includedNodeIds,
    includedEdgeIds: compiled.includedEdgeIds,
    nodeContent: compiled.nodeContent,
    mermaid: {
      included: true,
      text: compiled.mermaid,
    },
    projectionSupport: compiled.projectionSupport,
    omissions: compiled.projectionSupport.omissions,
  };
}

export async function toolValidateDocument(arguments_: ToolArguments): Promise<Record<string, unknown>> {
  const document = await documentFromArguments(arguments_);
  validateDocument(document);
  return { ok: true, ...summarizeDocument(document) };
}

export const toolRegistry: Record<string, ToolHandler> = {
  get_document_summary: toolGetDocumentSummary,
  get_node: toolGetNode,
  get_neighbors: toolGetNeighbors,
  extract_subtree: toolExtractSubtree,
  compile_mermaid_context: toolCompileMermaidContext,
  preview_operations: toolPreviewOperations,
  apply_operations: toolApplyOperations,
  render_reactflow_view: toolRenderReactflowView,
  get_current_selection: toolGetCurrentSelection,
  build_context_from_selection: toolBuildContextFromSelection,
  validate_document: toolValidateDocument,
};

async function documentFromArguments(arguments_: ToolArguments): Promise<GraphDocument> {
  return loadDocument(stringArgument(arguments_, 'documentPath'));
}

async function runtimeInfo(arguments_: ToolArguments): Promise<{ url: string; token?: string; documentPath?: string }> {
  const runtimePath = optionalStringArgument(arguments_, 'runtimePath') ?? DEFAULT_RUNTIME_PATH;
  try {
    const runtime = JSON.parse(await fs.readFile(runtimePath, 'utf8')) as unknown;
    if (
      !runtime ||
      typeof runtime !== 'object' ||
      typeof (runtime as { url?: unknown }).url !== 'string'
    ) {
      throw new ToolInputError('WebUI runtime metadata is invalid.', { runtimePath });
    }
    return runtime as { url: string; token?: string; documentPath?: string };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ToolInputError('WebUI runtime metadata was not found. Start the WebUI first.', { runtimePath });
    }
    if (error instanceof SyntaxError) {
      throw new ToolInputError('WebUI runtime metadata is invalid.', { runtimePath });
    }
    throw error;
  }
}

async function fetchWebUISelection(arguments_: ToolArguments): Promise<{
  ok: true;
  documentId: string;
  documentPath: string;
  graphVersion: number;
  nodeIds: Array<string>;
  edgeIds: Array<string>;
  updatedAt: string | null;
  stale: boolean;
}> {
  const runtime = await runtimeInfo(arguments_);
  const response = await fetch(new URL('/api/selection', runtime.url), {
    headers: runtime.token ? { 'X-Mindmap-Token': runtime.token } : undefined,
  });
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    throw new ToolInputError('WebUI selection endpoint returned an error.', payload as Record<string, unknown>);
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    (payload as { ok?: unknown }).ok !== true ||
    !Array.isArray((payload as { nodeIds?: unknown }).nodeIds) ||
    !Array.isArray((payload as { edgeIds?: unknown }).edgeIds)
  ) {
    throw new ToolInputError('WebUI selection endpoint returned an invalid payload.', { payload });
  }
  return payload as Awaited<ReturnType<typeof fetchWebUISelection>>;
}

function assertSelectionMatchesDocument(
  selection: Awaited<ReturnType<typeof fetchWebUISelection>>,
  document: GraphDocument,
  documentPath?: string,
): void {
  validateDocument(document);
  if (selection.documentId !== document.metadata.id) {
    throw new ToolInputError('WebUI selection belongs to a different document.', {
      selectionDocumentId: selection.documentId,
      documentId: document.metadata.id,
    });
  }
  if (selection.graphVersion !== document.metadata.graphVersion) {
    throw new ToolInputError('WebUI selection graphVersion is stale for the current document.', {
      selectionGraphVersion: selection.graphVersion,
      graphVersion: document.metadata.graphVersion,
    });
  }
  if (documentPath && selection.documentPath !== resolve(documentPath)) {
    throw new ToolInputError('WebUI selection path does not match documentPath.', {
      selectionDocumentPath: selection.documentPath,
      documentPath: resolve(documentPath),
    });
  }
}

function stringArgument(arguments_: ToolArguments, key: string, fallback?: string): string {
  const value = arguments_[key];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string' || !value) throw new ToolInputError(`${key} is required.`);
  return value;
}

function optionalStringArgument(arguments_: ToolArguments, key: string): string | undefined {
  const value = arguments_[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ToolInputError(`${key} must be a string.`);
  return value;
}

function objectArgument(arguments_: ToolArguments, key: string): Record<string, unknown> {
  const value = arguments_[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ToolInputError(`${key} is required.`);
  return value as Record<string, unknown>;
}

function numberArgument(arguments_: ToolArguments, key: string, fallback: number): number {
  const value = arguments_[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number') throw new ToolInputError(`${key} must be a number.`);
  return value;
}

function optionalNumberArgument(arguments_: ToolArguments, key: string): number | undefined {
  const value = arguments_[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number') throw new ToolInputError(`${key} must be a number.`);
  return value;
}

function booleanArgument(arguments_: ToolArguments, key: string, fallback: boolean): boolean {
  const value = arguments_[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new ToolInputError(`${key} must be a boolean.`);
  return value;
}

function enumArgument<const T extends string>(
  arguments_: ToolArguments,
  key: string,
  values: ReadonlyArray<T>,
  fallback: T,
): T {
  const value = arguments_[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new ToolInputError(`${key} must be one of: ${values.join(', ')}.`);
  }
  return value as T;
}

export function errorToToolPayload(error: unknown): Record<string, unknown> {
  if (error instanceof MindMapError) return error.toPayload();
  return {
    ok: false,
    error: {
      code: 'UNEXPECTED_ERROR',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  };
}

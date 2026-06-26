import { createReadStream, promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MindMapError } from '../core/errors.js';
import { applyOperations, type GraphDocument, type OperationEnvelope, isRecord, validateDocument } from '../core/graph.js';
import { defaultViewState, toReactFlowView, type ViewState } from '../core/layout.js';

type JsonObject = Record<string, unknown>;

export type RuntimeInfo = {
  host: string;
  port: number;
  url: string;
  token?: string;
  documentPath: string;
  viewStatePath: string;
  startedAt: string;
};

export type WebUIServiceOptions = {
  documentPath: string;
  host?: '127.0.0.1' | 'localhost';
  port?: number;
  staticDir?: string;
  runtimePath?: string;
  viewStateDir?: string;
};

export type WebUIServiceHandle = {
  server: Server;
  runtime: RuntimeInfo;
  close: () => Promise<void>;
};

const currentDir = fileURLToPath(new URL('.', import.meta.url));
export const WEBUI_ROOT = resolve(currentDir, '..', '..');
export const REPO_ROOT = resolve(WEBUI_ROOT, '..');
export const DEFAULT_STATIC_DIR = resolve(WEBUI_ROOT, 'dist');
export const DEFAULT_RUNTIME_PATH = resolve(REPO_ROOT, '.mindmap', 'runtime', 'webui.json');
export const DEFAULT_VIEW_STATE_DIR = resolve(REPO_ROOT, '.mindmap', 'view-state');

export class WebUIError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details: JsonObject = {},
  ) {
    super(message);
  }

  toPayload(): JsonObject {
    return { ok: false, error: { code: this.code, message: this.message, details: this.details } };
  }
}

export async function startWebUIService(options: WebUIServiceOptions): Promise<WebUIServiceHandle> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new WebUIError('INVALID_HOST', 'WebUI v1 only supports localhost bindings.');
  }

  const documentPath = resolvePath(options.documentPath);
  const staticDir = resolvePath(options.staticDir ?? DEFAULT_STATIC_DIR);
  const viewStateDir = resolvePath(options.viewStateDir ?? DEFAULT_VIEW_STATE_DIR);
  let selection = { nodeIds: [] as Array<string>, edgeIds: [] as Array<string>, updatedAt: null as string | null };

  const server = createServer(async (request, response) => {
    try {
      const url = requestUrl(request);
      if (request.method === 'GET' && url.pathname === '/api/health') {
        await sendJson(response, await healthPayload(documentPath, viewStateDir));
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'GET' && url.pathname === '/api/graph') {
          await sendJson(response, await loadGraphProjection(documentPath, viewStateDir));
          return;
        }

        if (request.method === 'GET' && url.pathname === '/api/selection') {
          const projection = await loadGraphProjection(documentPath, viewStateDir);
          const validNodeIds = new Set(projection.nodes.map((node) => node.id));
          const validEdgeIds = new Set(projection.edges.map((edge) => edge.id));
          const nodeIds = selection.nodeIds.filter((nodeId) => validNodeIds.has(nodeId));
          const edgeIds = selection.edgeIds.filter((edgeId) => validEdgeIds.has(edgeId));
          await sendJson(response, {
            ok: true,
            documentPath,
            documentId: projection.documentId,
            graphVersion: projection.graphVersion,
            nodeIds,
            edgeIds,
            updatedAt: selection.updatedAt,
            stale: nodeIds.length !== selection.nodeIds.length || edgeIds.length !== selection.edgeIds.length,
          });
          return;
        }

        if (request.method === 'GET' && url.pathname === '/api/view-state') {
          const { documentId, graphVersion } = await documentIdentity(documentPath);
          await sendJson(response, {
            ok: true,
            documentPath,
            documentId,
            graphVersion,
            viewStatePath: viewStatePathFor(viewStateDir, documentId),
            viewState: await readViewState(viewStateDir, documentId),
          });
          return;
        }

        if (request.method === 'POST' && url.pathname === '/api/selection') {
          const payload = await readJsonBody(request);
          const projection = await loadGraphProjection(documentPath, viewStateDir);
          assertGraphVersion(payload, projection.graphVersion, 'Selection');
          const nodeIds = requireStringList(payload.nodeIds, 'nodeIds');
          const edgeIds = payload.edgeIds === undefined ? [] : requireStringList(payload.edgeIds, 'edgeIds');
          const validNodeIds = new Set(projection.nodes.map((node) => node.id));
          const validEdgeIds = new Set(projection.edges.map((edge) => edge.id));
          const unknownNodeIds = nodeIds.filter((nodeId) => !validNodeIds.has(nodeId));
          const unknownEdgeIds = edgeIds.filter((edgeId) => !validEdgeIds.has(edgeId));
          if (unknownNodeIds.length > 0 || unknownEdgeIds.length > 0) {
            throw new WebUIError(
              'INVALID_SELECTION',
              'Selection references nodes or edges outside the current ReactFlow projection.',
              400,
              { unknownNodeIds, unknownEdgeIds },
            );
          }
          selection = { nodeIds: [...new Set(nodeIds)], edgeIds: [...new Set(edgeIds)], updatedAt: utcNow() };
          await sendJson(response, {
            ok: true,
            documentPath,
            documentId: projection.documentId,
            graphVersion: projection.graphVersion,
            ...selection,
            stale: false,
          });
          return;
        }

        if (request.method === 'POST' && url.pathname === '/api/view-state') {
          const payload = await readJsonBody(request);
          const projection = await loadGraphProjection(documentPath, viewStateDir);
          assertGraphVersion(payload, projection.graphVersion, 'View-state');
          await updateViewState(viewStateDir, projection, payload);
          const nextViewState = await readViewState(viewStateDir, projection.documentId);
          await sendJson(response, {
            ok: true,
            documentPath,
            documentId: projection.documentId,
            graphVersion: projection.graphVersion,
            viewStatePath: viewStatePathFor(viewStateDir, projection.documentId),
            viewState: nextViewState,
          });
          return;
        }

        if (request.method === 'POST' && url.pathname === '/api/operations') {
          const envelope = (await readJsonBody(request)) as OperationEnvelope;
          const document = await loadDocument(documentPath);
          const { document: updated, result } = applyOperations(document, envelope);
          await writeDocument(documentPath, updated);
          const graph = await loadGraphProjection(documentPath, viewStateDir);
          await sendJson(response, {
            ok: true,
            documentPath,
            documentId: updated.metadata.id,
            graphVersion: updated.metadata.graphVersion,
            result,
            graph,
          });
          return;
        }

        await sendJson(response, errorPayload('NOT_FOUND', 'Endpoint not found.'), 404);
        return;
      }

      await serveStatic(response, staticDir, url.pathname);
    } catch (error) {
      if (error instanceof WebUIError) {
        await sendJson(response, error.toPayload(), error.status);
        return;
      }
      if (error instanceof MindMapError) {
        await sendJson(response, error.toPayload(), error instanceof MindMapError && error.code === 'CONFLICT' ? 409 : 400);
        return;
      }
      await sendJson(
        response,
        errorPayload('UNEXPECTED_ERROR', error instanceof Error ? error.message : String(error)),
        500,
      );
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port ?? 0, host, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new WebUIError('INVALID_SERVER_ADDRESS', 'Unable to resolve WebUI server address.', 500);
  }

  const documentId = (await documentIdentity(documentPath)).documentId;
  const runtime: RuntimeInfo = {
    host,
    port: address.port,
    url: `http://${host}:${address.port}/`,
    documentPath,
    viewStatePath: viewStatePathFor(viewStateDir, documentId),
    startedAt: new Date().toISOString(),
  };

  if (options.runtimePath) {
    await writeJsonFile(resolvePath(options.runtimePath), runtime);
  }

  return {
    server,
    runtime,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

export async function loadGraphProjection(documentPath: string, viewStateDir: string): Promise<ReturnType<typeof toReactFlowView> & {
  hasViewState: boolean;
  viewStateUpdatedAt: string | null;
}> {
  const document = await loadDocument(documentPath);
  const viewState = await readViewState(viewStateDir, document.metadata.id);
  return {
    ...toReactFlowView(document, viewState),
    hasViewState: Boolean(viewState.updatedAt),
    viewStateUpdatedAt: viewState.updatedAt,
  };
}

export async function loadDocument(documentPath: string): Promise<GraphDocument> {
  try {
    const body = await fs.readFile(documentPath, 'utf8');
    const document = JSON.parse(body) as unknown;
    validateDocument(document);
    return document;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WebUIError('DOCUMENT_NOT_FOUND', `Document not found: ${documentPath}`, 404);
    }
    if (error instanceof SyntaxError) {
      throw new WebUIError('INVALID_JSON', `Document is not valid JSON: ${error.message}`);
    }
    throw error;
  }
}

export async function writeDocument(documentPath: string, document: GraphDocument): Promise<void> {
  validateDocument(document);
  await writeJsonFile(resolvePath(documentPath), document);
}

export async function readViewState(viewStateDir: string, documentId: string): Promise<ViewState> {
  const fallback = defaultViewState(documentId);
  try {
    const body = await fs.readFile(viewStatePathFor(viewStateDir, documentId), 'utf8');
    const payload = JSON.parse(body) as Partial<ViewState>;
    if (!payload || typeof payload !== 'object' || payload.documentId !== documentId) return fallback;
    return {
      ...fallback,
      positions: isRecord(payload.positions) ? validatePositionMap(payload.positions) : fallback.positions,
      dimensions: isRecord(payload.dimensions) ? validateDimensionMap(payload.dimensions) : fallback.dimensions,
      collapsed: Array.isArray(payload.collapsed) ? payload.collapsed.filter((value) => typeof value === 'string') : [],
      viewport: isRecord(payload.viewport) ? validateViewport(payload.viewport) : fallback.viewport,
      updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    if (error instanceof SyntaxError) {
      throw new WebUIError('INVALID_VIEW_STATE', `View-state file is not valid JSON: ${error.message}`);
    }
    throw error;
  }
}

export function viewStatePathFor(viewStateDir: string, documentId: string): string {
  return resolve(viewStateDir, `${safeFilename(documentId)}.webui.json`);
}

export async function documentIdentity(documentPath: string): Promise<{ document: GraphDocument; documentId: string; graphVersion: number }> {
  const document = await loadDocument(documentPath);
  return { document, documentId: document.metadata.id, graphVersion: document.metadata.graphVersion };
}

async function healthPayload(documentPath: string, viewStateDir: string): Promise<JsonObject> {
  try {
    const projection = await loadGraphProjection(documentPath, viewStateDir);
    return {
      ok: true,
      documentPath,
      documentId: projection.documentId,
      graphVersion: projection.graphVersion,
      viewStatePath: viewStatePathFor(viewStateDir, projection.documentId),
    };
  } catch (error) {
    if (error instanceof WebUIError) return { ...error.toPayload(), documentPath };
    if (error instanceof MindMapError) return { ...error.toPayload(), documentPath };
    throw error;
  }
}

async function updateViewState(
  viewStateDir: string,
  projection: Awaited<ReturnType<typeof loadGraphProjection>>,
  payload: JsonObject,
): Promise<void> {
  if (payload.positions === undefined && payload.viewport === undefined) {
    throw new WebUIError('INVALID_VIEW_STATE', 'positions or viewport must be provided.');
  }
  const current = await readViewState(viewStateDir, projection.documentId);
  const validNodeIds = new Set(projection.nodes.map((node) => node.id));
  const nextViewState: ViewState = {
    ...current,
    documentId: projection.documentId,
    viewId: 'webui-default',
    updatedAt: utcNow(),
  };

  if (payload.positions !== undefined) {
    if (!isRecord(payload.positions)) throw new WebUIError('INVALID_VIEW_STATE', 'positions must be an object keyed by node id.');
    const positions = validatePositionMap(payload.positions);
    const unknownNodeIds = Object.keys(positions).filter((nodeId) => !validNodeIds.has(nodeId));
    if (unknownNodeIds.length > 0) {
      throw new WebUIError('INVALID_VIEW_STATE', 'positions references nodes outside the current ReactFlow projection.', 400, {
        unknownNodeIds,
      });
    }
    nextViewState.positions = positions;
  }

  if (payload.viewport !== undefined) {
    if (!isRecord(payload.viewport)) throw new WebUIError('INVALID_VIEW_STATE', 'viewport must be an object.');
    nextViewState.viewport = validateViewport(payload.viewport);
  }

  await writeJsonFile(viewStatePathFor(viewStateDir, projection.documentId), nextViewState);
}

function validatePositionMap(value: JsonObject): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [nodeId, position] of Object.entries(value)) {
    if (!isRecord(position)) throw new WebUIError('INVALID_VIEW_STATE', 'Each position must be an object.');
    const { x, y } = position;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      throw new WebUIError('INVALID_VIEW_STATE', 'Each position must include finite numeric x and y.');
    }
    positions[nodeId] = { x, y };
  }
  return positions;
}

function validateDimensionMap(value: JsonObject): Record<string, { width: number; height: number }> {
  const dimensions: Record<string, { width: number; height: number }> = {};
  for (const [nodeId, dimension] of Object.entries(value)) {
    if (!isRecord(dimension)) continue;
    const { width, height } = dimension;
    if (isFiniteNumber(width) && isFiniteNumber(height)) dimensions[nodeId] = { width, height };
  }
  return dimensions;
}

function validateViewport(value: JsonObject): { x: number; y: number; zoom: number } {
  const { x, y, zoom } = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(zoom) || zoom <= 0) {
    throw new WebUIError('INVALID_VIEW_STATE', 'viewport must include finite numeric x, y, and positive zoom.');
  }
  return { x, y, zoom };
}

function assertGraphVersion(payload: JsonObject, graphVersion: number, label: string): void {
  if (payload.graphVersion !== graphVersion) {
    throw new WebUIError('STALE_GRAPH_VERSION', `${label} graphVersion does not match the current document graphVersion.`, 409);
  }
}

async function serveStatic(response: ServerResponse, staticDir: string, requestPath: string): Promise<void> {
  try {
    if (!(await fs.stat(staticDir)).isDirectory()) throw new Error('not-directory');
  } catch {
    await sendJson(
      response,
      errorPayload('WEBUI_NOT_BUILT', 'WebUI static assets were not found. Run npm install && npm run build in webui/.', {
        staticDir,
      }),
      503,
    );
    return;
  }

  const staticRoot = resolve(staticDir);
  const relative = decodePath(requestPath).replace(/^\/+/, '') || 'index.html';
  let target = resolve(staticRoot, relative);
  if (!isInside(target, staticRoot) || !(await isFile(target))) target = resolve(staticRoot, 'index.html');
  if (!(await isFile(target))) {
    await sendJson(response, errorPayload('WEBUI_NOT_BUILT', 'WebUI index.html was not found.', { staticDir }), 503);
    return;
  }

  response.writeHead(200, { 'Content-Type': contentType(target), 'Cache-Control': 'no-store' });
  await new Promise<void>((resolveStream, rejectStream) => {
    createReadStream(target).on('error', rejectStream).on('end', resolveStream).pipe(response);
  });
}

async function readJsonBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Array<Buffer> = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) throw new WebUIError('INVALID_REQUEST', 'Request body must be a JSON object.');
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!isRecord(payload)) throw new WebUIError('INVALID_REQUEST', 'Request body must be a JSON object.');
  return payload;
}

async function sendJson(response: ServerResponse, payload: JsonObject, status = 200): Promise<void> {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function writeJsonFile(filePath: string, payload: JsonObject): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function requestUrl(request: IncomingMessage): URL {
  return new URL(request.url ?? '/', 'http://127.0.0.1');
}

function requireStringList(value: unknown, name: string): Array<string> {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new WebUIError('INVALID_SELECTION', `${name} must be a list of strings.`);
  }
  return value;
}

function errorPayload(code: string, message: string, details: JsonObject = {}): JsonObject {
  return { ok: false, error: { code, message, details } };
}

function safeFilename(value: string): string {
  const safe = [...value].map((character) => (/^[a-z0-9_-]$/i.test(character) ? character : '_')).join('');
  return safe || 'document';
}

function utcNow(): string {
  return new Date().toISOString();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function isInside(target: string, root: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return target === root || target.startsWith(normalizedRoot);
}

function resolvePath(filePath: string): string {
  return isAbsolute(filePath) ? resolve(filePath) : resolve(REPO_ROOT, filePath);
}

function decodePath(requestPath: string): string {
  try {
    return decodeURIComponent(requestPath);
  } catch {
    return requestPath;
  }
}

function contentType(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

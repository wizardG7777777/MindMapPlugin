import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import type { GraphDocument } from '../src/core/graph.js';
import { startWebUIService, type WebUIServiceHandle } from '../src/server/service.js';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const sampleDocument = resolve(repoRoot, 'samples', 'documents', 'sample-mindmap.json');

let handles: Array<WebUIServiceHandle> = [];

beforeEach(() => {
  handles = [];
});

afterEach(async () => {
  await Promise.allSettled(handles.map((handle) => handle.close()));
});

describe('TypeScript WebUI service', () => {
  it('serves health and graph projection for a canonical document', async () => {
    const tempRoot = await makeTempDir();
    const document = await readSampleDocument();
    const handle = await startService(tempRoot);

    const health = await getJson(`${baseUrl(handle)}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(health.payload.ok, true);
    assert.equal(health.payload.documentId, document.metadata.id);
    assert.equal(health.payload.graphVersion, document.metadata.graphVersion);
    assert.equal(health.payload.documentPath, sampleDocument);

    const graph = await getJson(`${baseUrl(handle)}/api/graph`);
    assert.equal(graph.status, 200);
    assert.equal(graph.payload.ok, true);
    assert.equal(graph.payload.documentId, document.metadata.id);
    assert.equal(graph.payload.graphVersion, document.metadata.graphVersion);
    assert.equal(graph.payload.nodes.length, Object.keys(document.graph.nodes).length);
    assert.equal(graph.payload.edges.length, Object.keys(document.graph.edges).length);
    assert.equal('metadata' in graph.payload, false);
    assert.equal('graph' in graph.payload, false);
  });

  it('stores selection in memory without mutating the canonical document', async () => {
    const tempRoot = await makeTempDir();
    const document = await readSampleDocument();
    const beforeHash = await fileHash(sampleDocument);
    const handle = await startService(tempRoot);

    const selection = await postJson(
      `${baseUrl(handle)}/api/selection`,
      {
        graphVersion: document.metadata.graphVersion,
        nodeIds: ['market', 'research'],
        edgeIds: ['edge_market_research_reference'],
      },
    );

    assert.equal(selection.status, 200);
    assert.equal(selection.payload.ok, true);
    assert.deepEqual(selection.payload.nodeIds, ['market', 'research']);
    assert.deepEqual(selection.payload.edgeIds, ['edge_market_research_reference']);
    assert.equal(selection.payload.stale, false);

    const current = await getJson(`${baseUrl(handle)}/api/selection`);
    assert.equal(current.status, 200);
    assert.deepEqual(current.payload.nodeIds, ['market', 'research']);
    assert.equal(await fileHash(sampleDocument), beforeHash);
  });

  it('persists view-state outside canonical JSON and rehydrates graph projection', async () => {
    const tempRoot = await makeTempDir();
    const document = await readSampleDocument();
    const beforeHash = await fileHash(sampleDocument);
    const handle = await startService(tempRoot);

    const viewState = await postJson(
      `${baseUrl(handle)}/api/view-state`,
      {
        graphVersion: document.metadata.graphVersion,
        positions: { market: { x: 111, y: 222 } },
        viewport: { x: -50, y: -80, zoom: 1.25 },
      },
    );

    assert.equal(viewState.status, 200);
    assert.equal(viewState.payload.ok, true);
    assert.deepEqual(viewState.payload.viewState.positions, { market: { x: 111, y: 222 } });
    assert.deepEqual(viewState.payload.viewState.viewport, { x: -50, y: -80, zoom: 1.25 });
    assert.equal(await fileHash(sampleDocument), beforeHash);

    const graph = await getJson(`${baseUrl(handle)}/api/graph`);
    const market = graph.payload.nodes.find((node: { id: string }) => node.id === 'market');
    assert.deepEqual(market.position, { x: 111, y: 222 });
    assert.deepEqual(graph.payload.viewport, { x: -50, y: -80, zoom: 1.25 });
    assert.equal(graph.payload.hasViewState, true);
  });

  it('rejects stale or invalid view and selection updates', async () => {
    const tempRoot = await makeTempDir();
    const document = await readSampleDocument();
    const handle = await startService(tempRoot);
    const staleVersion = document.metadata.graphVersion - 1;

    const staleSelection = await postJson(
      `${baseUrl(handle)}/api/selection`,
      { graphVersion: staleVersion, nodeIds: ['market'], edgeIds: [] },
    );
    assert.equal(staleSelection.status, 409);
    assert.equal(staleSelection.payload.error.code, 'STALE_GRAPH_VERSION');

    const unknownSelection = await postJson(
      `${baseUrl(handle)}/api/selection`,
      { graphVersion: document.metadata.graphVersion, nodeIds: ['missing'], edgeIds: [] },
    );
    assert.equal(unknownSelection.status, 400);
    assert.equal(unknownSelection.payload.error.code, 'INVALID_SELECTION');

    const invalidViewState = await postJson(
      `${baseUrl(handle)}/api/view-state`,
      { graphVersion: document.metadata.graphVersion, positions: { missing: { x: 1, y: 2 } } },
    );
    assert.equal(invalidViewState.status, 400);
    assert.equal(invalidViewState.payload.error.code, 'INVALID_VIEW_STATE');
  });

  it('applies canonical text edits through operation envelopes', async () => {
    const tempRoot = await makeTempDir();
    const documentPath = await makeDocumentCopy(tempRoot);
    const document = await readDocument(documentPath);
    const handle = await startService(tempRoot, documentPath);

    const edited = await postJson(
      `${baseUrl(handle)}/api/operations`,
      {
        documentId: document.metadata.id,
        baseGraphVersion: document.metadata.graphVersion,
        operations: [
          {
            type: 'updateNode',
            nodeId: 'market',
            patch: {
              title: 'Market Landscape',
              cardContent: 'Competitor and user research',
            },
          },
        ],
      },
    );

    assert.equal(edited.status, 200);
    assert.equal(edited.payload.ok, true);
    assert.equal(edited.payload.result.applied, true);
    assert.equal(edited.payload.graphVersion, document.metadata.graphVersion + 1);
    assert.equal(edited.payload.graph.graphVersion, document.metadata.graphVersion + 1);
    const projectedMarket = edited.payload.graph.nodes.find((node: { id: string }) => node.id === 'market');
    assert.equal(projectedMarket.data.title, 'Market Landscape');
    assert.equal(projectedMarket.data.cardContent, 'Competitor and user research');

    const persisted = await readDocument(documentPath);
    assert.equal(persisted.metadata.graphVersion, document.metadata.graphVersion + 1);
    assert.equal(persisted.graph.nodes.market.title, 'Market Landscape');
    assert.equal(persisted.graph.nodes.market.cardContent, 'Competitor and user research');

    const stale = await postJson(
      `${baseUrl(handle)}/api/operations`,
      {
        documentId: document.metadata.id,
        baseGraphVersion: document.metadata.graphVersion,
        operations: [{ type: 'updateNode', nodeId: 'market', patch: { title: 'Stale' } }],
      },
    );
    assert.equal(stale.status, 409);
    assert.equal(stale.payload.error.code, 'CONFLICT');
  });
});

async function startService(tempRoot: string, documentPath = sampleDocument): Promise<WebUIServiceHandle> {
  const handle = await startWebUIService({
    documentPath,
    viewStateDir: join(tempRoot, 'view-state'),
    runtimePath: join(tempRoot, 'runtime', 'webui.json'),
  });
  handles.push(handle);
  return handle;
}

function baseUrl(handle: WebUIServiceHandle): string {
  return `http://${handle.runtime.host}:${handle.runtime.port}`;
}

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), 'mindmap-webui-service-'));
}

async function readSampleDocument(): Promise<GraphDocument> {
  return readDocument(sampleDocument);
}

async function readDocument(documentPath: string): Promise<GraphDocument> {
  return JSON.parse(await fs.readFile(documentPath, 'utf8')) as GraphDocument;
}

async function makeDocumentCopy(tempRoot: string): Promise<string> {
  const documentPath = join(tempRoot, 'sample-mindmap.json');
  await fs.copyFile(sampleDocument, documentPath);
  return documentPath;
}

async function fileHash(filePath: string): Promise<string> {
  return crypto.createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

async function getJson(url: string): Promise<{ status: number; payload: any }> {
  const response = await fetch(url);
  return { status: response.status, payload: await response.json() };
}

async function postJson(url: string, payload: unknown): Promise<{ status: number; payload: any }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, payload: await response.json() };
}

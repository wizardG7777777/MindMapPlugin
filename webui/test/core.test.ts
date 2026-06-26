import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import { applyOperations, getNeighbors, previewOperations, summarizeDocument, type GraphDocument, type OperationEnvelope } from '../src/core/graph.js';
import { toReactFlowView } from '../src/core/layout.js';
import { compileDocumentToMermaidContext } from '../src/core/mermaid.js';
import { extractSubtree, selectionProjection } from '../src/core/projections.js';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const sampleDocument = resolve(repoRoot, 'samples', 'documents', 'sample-mindmap.json');
const sampleOperation = resolve(repoRoot, 'samples', 'operations', 'add-pricing.json');

describe('TypeScript graph core, operation schema, and projections', () => {
  it('summarizes and queries the canonical graph', async () => {
    const document = await loadDocument();
    assert.deepEqual(summarizeDocument(document), {
      documentId: 'doc_001',
      title: 'Untitled Mind Map',
      graphVersion: document.metadata.graphVersion,
      diagramKind: 'mindmap',
      entryNodeId: 'topic',
      nodeCount: 4,
      edgeCount: 3,
      relationCounts: {
        contains: 2,
        reference: 1,
      },
    });

    const neighbors = getNeighbors(document, 'market');
    assert.deepEqual(neighbors.outgoing.map((edge) => edge.id), ['edge_market_research_reference']);
    assert.deepEqual(neighbors.incoming.map((edge) => edge.id), ['edge_topic_market']);
  });

  it('previews and applies typed operation envelopes without mutating the original document', async () => {
    const document = await loadDocument();
    const envelope = await loadOperation();
    const before = JSON.stringify(document);

    const preview = previewOperations(document, envelope);
    assert.deepEqual(preview, {
      ok: true,
      documentId: 'doc_001',
      baseGraphVersion: document.metadata.graphVersion,
      nextGraphVersion: document.metadata.graphVersion + 1,
      operationCount: 2,
      affectedNodeIds: ['pricing'],
      affectedEdgeIds: ['edge_market_pricing'],
      summary: '2 operation(s), 1 node(s), 1 edge(s) affected.',
    });
    assert.equal(JSON.stringify(document), before);

    const { document: updated, result } = applyOperations(document, envelope);
    assert.equal(result.applied, true);
    assert.equal(updated.metadata.graphVersion, document.metadata.graphVersion + 1);
    assert.equal(updated.graph.nodes.pricing.title, 'Pricing');
    assert.equal(JSON.stringify(document), before);
  });

  it('builds subtree, selection, mermaid, and ReactFlow projections', async () => {
    const document = await loadDocument();
    const subtree = extractSubtree(document, 'market', 'outgoing', 3);
    assert.deepEqual(subtree.includedNodeIds, ['market', 'research']);
    assert.deepEqual(subtree.includedEdgeIds, ['edge_market_research_reference']);
    assert.deepEqual(subtree.markers, []);

    const selection = selectionProjection(document, ['market', 'research']);
    assert.deepEqual(selection.includedEdgeIds, ['edge_market_research_reference']);

    const mermaid = compileDocumentToMermaidContext(document, { startNodeId: 'market', maxDepth: 3 });
    assert.equal(mermaid.graphVersion, document.metadata.graphVersion);
    assert.equal(mermaid.mermaid, 'flowchart LR\n  n_market["Market"]\n  n_research["Research"]\n\n  n_market -->|"reference"| n_research');

    const view = toReactFlowView(document);
    assert.equal(view.documentId, 'doc_001');
    assert.equal(view.nodes.length, 4);
    assert.equal(view.edges.length, 3);
    assert.equal(view.nodes.find((node) => node.id === 'market')?.type, 'topicCard');
  });

  it('ignores stale view-state dimensions that are smaller than text content needs', async () => {
    const document = await loadDocument();
    const naturalView = toReactFlowView(document);
    const constrainedView = toReactFlowView(document, {
      documentId: document.metadata.id,
      viewId: 'webui-default',
      positions: {},
      dimensions: {
        market: { width: 80, height: 40 },
        topic: { width: 80, height: 40 },
      },
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: new Date().toISOString(),
    });

    for (const nodeId of ['market', 'topic']) {
      const natural = naturalView.nodes.find((node) => node.id === nodeId);
      const constrained = constrainedView.nodes.find((node) => node.id === nodeId);
      assert.ok(natural);
      assert.ok(constrained);
      assert.equal(constrained.width, natural.width);
      assert.equal(constrained.height, natural.height);
    }
  });
});

async function loadDocument(): Promise<GraphDocument> {
  return JSON.parse(await fs.readFile(sampleDocument, 'utf8')) as GraphDocument;
}

async function loadOperation(): Promise<OperationEnvelope> {
  return JSON.parse(await fs.readFile(sampleOperation, 'utf8')) as OperationEnvelope;
}

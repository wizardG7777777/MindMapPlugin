import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const webuiRoot = resolve(repoRoot, 'webui');
const tsxBin = resolve(webuiRoot, 'node_modules', '.bin', 'tsx');
const cliPath = resolve(webuiRoot, 'src', 'cli.ts');
const sampleDocument = resolve(repoRoot, 'samples', 'documents', 'sample-mindmap.json');
const sampleOperation = resolve(repoRoot, 'samples', 'operations', 'add-pricing.json');

describe('TypeScript CLI', () => {
  it('returns serialized agent context for Mermaid projections', async () => {
    const payload = await runCli([
      'compile-mermaid-context',
      '--document',
      sampleDocument,
      '--start-node-id',
      'market',
      '--max-depth',
      '3',
    ]);

    assert.equal(payload.ok, true);
    assert.deepEqual(payload.projectionSupport.scope, {
      type: 'subtree',
      rootNodeId: 'market',
      direction: 'outgoing',
      maxDepth: 3,
    });
    assert.equal(payload.projectionSupport.edges.p_0_edge_market_research_reference.kind, 'reference');
  });

  it('previews operation envelopes from stdin', async () => {
    const operationEnvelope = await fs.readFile(sampleOperation, 'utf8');
    const payload = await runCli(['preview-operations', '--document', sampleDocument, '--operations', '-'], operationEnvelope);

    assert.equal(payload.ok, true);
    assert.equal(payload.documentId, 'doc_001');
    assert.deepEqual(payload.affectedNodeIds, ['pricing']);
    assert.deepEqual(payload.affectedEdgeIds, ['edge_market_pricing']);
  });

  it('applies operation envelopes to an output document', async () => {
    const tempRoot = await fs.mkdtemp(join(tmpdir(), 'mindmap-ts-cli-'));
    const documentCopy = join(tempRoot, 'sample-mindmap.json');
    const outputPath = join(tempRoot, 'updated-mindmap.json');
    await fs.copyFile(sampleDocument, documentCopy);

    const payload = await runCli([
      'apply-operations',
      '--document',
      documentCopy,
      '--operations',
      sampleOperation,
      '--output',
      outputPath,
    ]);

    const original = JSON.parse(await fs.readFile(documentCopy, 'utf8'));
    const updated = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    assert.equal(payload.applied, true);
    assert.equal(payload.outputPath, outputPath);
    assert.equal(updated.metadata.graphVersion, original.metadata.graphVersion + 1);
    assert.equal(updated.graph.nodes.pricing.title, 'Pricing');
  });
});

async function runCli(args: Array<string>, stdin?: string): Promise<any> {
  const child = spawn(tsxBin, [cliPath, ...args], { cwd: webuiRoot, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout: Array<Buffer> = [];
  const stderr: Array<Buffer> = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  if (stdin !== undefined) {
    child.stdin.end(stdin);
  } else {
    child.stdin.end();
  }
  const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
    child.on('error', rejectExit);
    child.on('close', resolveExit);
  });
  if (exitCode !== 0) {
    throw new Error(Buffer.concat(stderr).toString('utf8') || `CLI exited with ${exitCode}`);
  }
  return JSON.parse(Buffer.concat(stdout).toString('utf8'));
}

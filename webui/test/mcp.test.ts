import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { callTool } from '../src/mcp/tools.js';
import { handle, tools } from '../src/mcp/server.js';
import { startWebUIService, type WebUIServiceHandle } from '../src/server/service.js';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const sampleDocument = resolve(repoRoot, 'samples', 'documents', 'sample-mindmap.json');
const mcpCommand = resolve(repoRoot, 'webui', 'node_modules', '.bin', 'tsx');
const mcpServer = resolve(repoRoot, 'webui', 'src', 'mcp', 'server.ts');

let handles: Array<WebUIServiceHandle> = [];

beforeEach(() => {
  handles = [];
});

afterEach(async () => {
  await Promise.allSettled(handles.map((handle_) => handle_.close()));
});

describe('TypeScript MCP tools and stdio handler', () => {
  it('exposes the expected mind-map tool surface', async () => {
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [
        'mindmap_get_document_summary',
        'mindmap_get_node',
        'mindmap_get_neighbors',
        'mindmap_extract_subtree',
        'mindmap_compile_mermaid_context',
        'mindmap_preview_operations',
        'mindmap_apply_operations',
        'mindmap_render_reactflow_view',
        'mindmap_get_current_selection',
        'mindmap_build_context_from_selection',
        'mindmap_validate_document',
      ],
    );

    const list = await handle({ id: 1, method: 'tools/list' });
    assert.equal((list?.result as { tools: Array<unknown> }).tools.length, tools.length);
  });

  it('calls graph tools through the MCP handler', async () => {
    const response = await handle({
      id: 2,
      method: 'tools/call',
      params: {
        name: 'mindmap_compile_mermaid_context',
        arguments: {
          documentPath: sampleDocument,
          startNodeId: 'market',
          maxDepth: 3,
        },
      },
    });

    const content = (response?.result as { content: Array<{ text: string }> }).content[0];
    const payload = JSON.parse(content.text);
    assert.equal(payload.ok, true);
    assert.equal(payload.documentId, 'doc_001');
    assert.equal(payload.mermaid, 'flowchart LR\n  n_market["Market"]\n  n_research["Research"]\n\n  n_market -->|"reference"| n_research');
  });

  it('speaks JSONL over stdio for MCP clients', async () => {
    const response = await callStdioServer('jsonl');
    assert.equal(response.result.serverInfo.name, 'mind-map');
  });

  it('keeps Content-Length stdio compatibility for legacy probes', async () => {
    const response = await callStdioServer('content-length');
    assert.equal(response.result.serverInfo.name, 'mind-map');
  });

  it('builds context from a running WebUI selection', async () => {
    const tempRoot = await fs.mkdtemp(join(tmpdir(), 'mindmap-ts-mcp-'));
    const handle_ = await startWebUIService({
      documentPath: sampleDocument,
      runtimePath: join(tempRoot, 'runtime', 'webui.json'),
      viewStateDir: join(tempRoot, 'view-state'),
    });
    handles.push(handle_);
    const document = JSON.parse(await fs.readFile(sampleDocument, 'utf8'));
    await fetch(`${baseUrl(handle_)}/api/selection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphVersion: document.metadata.graphVersion,
        nodeIds: ['market', 'research'],
        edgeIds: [],
      }),
    });

    const context = await callTool('build_context_from_selection', {
      documentPath: sampleDocument,
      runtimePath: join(tempRoot, 'runtime', 'webui.json'),
    });

    assert.equal(context.ok, true);
    assert.equal(context.contextId, 'ctx_webui_selection');
    assert.deepEqual(context.includedNodeIds, ['market', 'research']);
    assert.deepEqual(context.includedEdgeIds, ['edge_market_research_reference']);
    assert.equal((context.mermaid as { text: string }).text.includes('n_market["Market"]'), true);
  });
});

function baseUrl(handle_: WebUIServiceHandle): string {
  return `http://${handle_.runtime.host}:${handle_.runtime.port}`;
}

async function callStdioServer(mode: 'content-length' | 'jsonl'): Promise<{ result: { serverInfo: { name: string } } }> {
  const child = spawn(mcpCommand, [mcpServer], { stdio: ['pipe', 'pipe', 'pipe'] });
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'unit-test', version: '0' },
    },
  };
  const requestBody = JSON.stringify(request);
  const output = new Promise<{ result: { serverInfo: { name: string } } }>((resolveOutput, rejectOutput) => {
    let stdout = Buffer.alloc(0);
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      rejectOutput(new Error(`Timed out waiting for MCP stdio response. stderr=${stderr}`));
    }, 5_000);

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      try {
        if (mode === 'jsonl') {
          const newline = stdout.indexOf('\n');
          if (newline === -1) return;
          clearTimeout(timeout);
          resolveOutput(JSON.parse(stdout.subarray(0, newline).toString('utf8')));
          child.kill('SIGTERM');
          return;
        }

        const match = /^Content-Length: (\d+)\r\n\r\n/.exec(stdout.toString('utf8'));
        if (!match) return;
        const headerLength = match[0].length;
        const bodyLength = Number(match[1]);
        if (stdout.length < headerLength + bodyLength) return;
        clearTimeout(timeout);
        resolveOutput(JSON.parse(stdout.subarray(headerLength, headerLength + bodyLength).toString('utf8')));
        child.kill('SIGTERM');
      } catch (error) {
        clearTimeout(timeout);
        child.kill('SIGKILL');
        rejectOutput(error);
      }
    });
    child.on('exit', (code, signal) => {
      if (stdout.length === 0) {
        clearTimeout(timeout);
        rejectOutput(new Error(`MCP stdio server exited before responding. code=${code} signal=${signal} stderr=${stderr}`));
      }
    });
  });

  if (mode === 'jsonl') {
    child.stdin.write(`${requestBody}\n`);
  } else {
    child.stdin.write(`Content-Length: ${Buffer.byteLength(requestBody)}\r\n\r\n${requestBody}`);
  }
  return output;
}

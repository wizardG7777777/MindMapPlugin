import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { ensureWebUI, fetchHealth, readRuntimeInfo } from '../src/server/launcher.js';
import type { WebUIServiceHandle } from '../src/server/service.js';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const sampleDocument = resolve(repoRoot, 'samples', 'documents', 'sample-mindmap.json');

let handles: Array<WebUIServiceHandle> = [];

beforeEach(() => {
  handles = [];
});

afterEach(async () => {
  await Promise.allSettled(handles.map((handle) => handle.close()));
});

describe('TypeScript WebUI launcher', () => {
  it('starts a sidecar, writes runtime metadata, and reports healthy status', async () => {
    const tempRoot = await makeTempDir();
    const runtimePath = join(tempRoot, 'runtime', 'webui.json');
    const result = await ensureWebUI({
      documentPath: sampleDocument,
      runtimePath,
      viewStateDir: join(tempRoot, 'view-state'),
    });
    if (result.service) {
      handles.push(result.service);
    }

    assert.equal(result.status, 'started');
    assert.ok(result.service);
    assert.equal(result.runtime.documentPath, sampleDocument);
    assert.match(result.runtime.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

    const persisted = await readRuntimeInfo(runtimePath);
    assert.deepEqual(persisted, result.runtime);

    const health = await fetchHealth(result.runtime);
    assert.equal(health.ok, true);
    if (health.ok) {
      assert.equal(health.documentPath, sampleDocument);
      assert.equal(health.documentId, 'doc_001');
    }
  });

  it('reuses a healthy runtime for the same document', async () => {
    const tempRoot = await makeTempDir();
    const runtimePath = join(tempRoot, 'runtime', 'webui.json');
    const first = await ensureWebUI({
      documentPath: sampleDocument,
      runtimePath,
      viewStateDir: join(tempRoot, 'view-state'),
    });
    assert.ok(first.service);
    handles.push(first.service);

    const second = await ensureWebUI({
      documentPath: sampleDocument,
      runtimePath,
      viewStateDir: join(tempRoot, 'view-state'),
    });

    assert.equal(second.status, 'reused');
    assert.equal(second.service, undefined);
    assert.deepEqual(second.runtime, first.runtime);
  });

  it('restarts and rewrites runtime metadata when the previous sidecar is gone', async () => {
    const tempRoot = await makeTempDir();
    const runtimePath = join(tempRoot, 'runtime', 'webui.json');
    const first = await ensureWebUI({
      documentPath: sampleDocument,
      runtimePath,
      viewStateDir: join(tempRoot, 'view-state'),
    });
    assert.ok(first.service);
    await first.service.close();

    const deadHealth = await fetchHealth(first.runtime, 200);
    assert.equal(deadHealth.ok, false);

    const second = await ensureWebUI({
      documentPath: sampleDocument,
      runtimePath,
      viewStateDir: join(tempRoot, 'view-state'),
      healthTimeoutMs: 200,
    });
    if (second.service) {
      handles.push(second.service);
    }

    assert.equal(second.status, 'started');
    assert.ok(second.service);
    assert.equal(second.runtime.documentPath, sampleDocument);
    assert.match(second.runtime.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

    const persisted = await readRuntimeInfo(runtimePath);
    assert.deepEqual(persisted, second.runtime);
  });

  it('ignores invalid runtime metadata and starts a new sidecar', async () => {
    const tempRoot = await makeTempDir();
    const runtimePath = join(tempRoot, 'runtime', 'webui.json');
    await fs.mkdir(join(tempRoot, 'runtime'), { recursive: true });
    await fs.writeFile(runtimePath, '{"url": 42}', 'utf8');

    const result = await ensureWebUI({
      documentPath: sampleDocument,
      runtimePath,
      viewStateDir: join(tempRoot, 'view-state'),
    });
    if (result.service) {
      handles.push(result.service);
    }

    assert.equal(result.status, 'started');
    const runtime = await readRuntimeInfo(runtimePath);
    assert.equal(runtime?.documentPath, sampleDocument);
  });
});

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), 'mindmap-webui-launcher-'));
}

import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

import {
  DEFAULT_RUNTIME_PATH,
  DEFAULT_STATIC_DIR,
  DEFAULT_VIEW_STATE_DIR,
  type RuntimeInfo,
  startWebUIService,
  type WebUIServiceHandle,
  type WebUIServiceOptions,
} from './service.js';

export type LaunchOptions = WebUIServiceOptions & {
  healthTimeoutMs?: number;
};

export type LaunchResult = {
  status: 'reused' | 'started';
  runtime: RuntimeInfo;
  service?: WebUIServiceHandle;
};

export async function ensureWebUI(options: LaunchOptions): Promise<LaunchResult> {
  const runtimePath = resolve(options.runtimePath ?? DEFAULT_RUNTIME_PATH);
  const documentPath = resolve(options.documentPath);
  const existing = await readRuntimeInfo(runtimePath);

  if (existing && sameDocument(existing.documentPath, documentPath)) {
    const health = await fetchHealth(existing, options.healthTimeoutMs ?? 1500);
    if (health.ok && sameDocument(health.documentPath, documentPath)) {
      return { status: 'reused', runtime: existing };
    }
  }

  const service = await startWebUIService({
    documentPath,
    host: options.host,
    port: options.port,
    staticDir: options.staticDir ?? DEFAULT_STATIC_DIR,
    runtimePath,
    viewStateDir: options.viewStateDir ?? DEFAULT_VIEW_STATE_DIR,
  });
  return { status: 'started', runtime: service.runtime, service };
}

export async function readRuntimeInfo(runtimePath = DEFAULT_RUNTIME_PATH): Promise<RuntimeInfo | null> {
  try {
    const body = await fs.readFile(runtimePath, 'utf8');
    const runtime = JSON.parse(body) as Partial<RuntimeInfo>;
    if (
      typeof runtime.host !== 'string' ||
      typeof runtime.port !== 'number' ||
      typeof runtime.url !== 'string' ||
      typeof runtime.documentPath !== 'string' ||
      typeof runtime.viewStatePath !== 'string' ||
      typeof runtime.startedAt !== 'string'
    ) {
      return null;
    }
    return runtime as RuntimeInfo;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

export async function fetchHealth(
  runtime: Pick<RuntimeInfo, 'url'>,
  timeoutMs = 1500,
): Promise<{ ok: true; documentPath: string; documentId: string; graphVersion: number } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const healthUrl = new URL('/api/health', runtime.url);
    const response = await fetch(healthUrl, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, reason: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as unknown;
    if (
      payload &&
      typeof payload === 'object' &&
      (payload as { ok?: unknown }).ok === true &&
      typeof (payload as { documentPath?: unknown }).documentPath === 'string' &&
      typeof (payload as { documentId?: unknown }).documentId === 'string' &&
      typeof (payload as { graphVersion?: unknown }).graphVersion === 'number'
    ) {
      return payload as { ok: true; documentPath: string; documentId: string; graphVersion: number };
    }
    return { ok: false, reason: 'Invalid health payload' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function sameDocument(left: string, right: string): boolean {
  return resolve(left) === resolve(right);
}

import { expect, test, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startWebUIService } from '../src/server/service.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..', '..');
const sampleDocument = path.join(repoRoot, 'samples', 'documents', 'sample-mindmap.json');
const longTitle = 'Market Landscape and Competitive Signals';
const longContent =
  'Competitor and user research across segments, pricing pressure, demand signals, and validation findings for the current planning cycle.';

function fileHash(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function expectNodeTextInsideNodes(page: Page): Promise<void> {
  const report = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.topic-card-node')).flatMap((node) => {
      const nodeRect = node.getBoundingClientRect();
      return Array.from(node.querySelectorAll('textarea')).map((field) => {
        const rect = field.getBoundingClientRect();
        return {
          label: field.getAttribute('aria-label'),
          insideNode:
            rect.left >= nodeRect.left &&
            rect.top >= nodeRect.top &&
            rect.right <= nodeRect.right &&
            rect.bottom <= nodeRect.bottom,
          verticalTextFits: field.scrollHeight <= field.clientHeight + 1,
          horizontalTextFits: field.scrollWidth <= field.clientWidth + 1,
          field: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            clientWidth: field.clientWidth,
            clientHeight: field.clientHeight,
            scrollWidth: field.scrollWidth,
            scrollHeight: field.scrollHeight,
          },
          node: {
            left: nodeRect.left,
            top: nodeRect.top,
            right: nodeRect.right,
            bottom: nodeRect.bottom,
            width: nodeRect.width,
            height: nodeRect.height,
          },
        };
      });
    }),
  );
  expect(report).not.toEqual([]);
  expect(report.filter((item) => !item.insideNode || !item.verticalTextFits || !item.horizontalTextFits)).toEqual([]);
}

test('renders the projection and keeps canonical JSON unchanged', async ({ page }) => {
  const beforeHash = fileHash(sampleDocument);
  const baseURL = process.env.MINDMAP_WEBUI_URL;
  if (!baseURL) {
    test.skip(true, 'Set MINDMAP_WEBUI_URL to a running sidecar URL.');
  }

  await page.goto(baseURL!);
  await expect(page.getByRole('heading', { name: 'Mind Map' })).toBeVisible();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();

  const nodeBoxes = await page.locator('.react-flow__node').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }),
  );
  const selectionStart = {
    x: Math.max(8, Math.min(...nodeBoxes.map((box) => box.x)) - 30),
    y: Math.max(72, Math.min(...nodeBoxes.map((box) => box.y)) - 30),
  };
  const selectionEnd = {
    x: Math.max(...nodeBoxes.map((box) => box.x + box.width)) + 30,
    y: Math.max(...nodeBoxes.map((box) => box.y + box.height)) + 30,
  };
  await page.mouse.move(selectionStart.x, selectionStart.y);
  await page.mouse.down();
  await page.mouse.move(selectionEnd.x, selectionEnd.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel('Current selection')).toContainText('Selected 4 nodes. Ready for Codex context.');
  const syncedSelection = await page.evaluate(async () => {
    const response = await fetch('/api/selection');
    return response.json();
  });
  expect(syncedSelection).toMatchObject({
    ok: true,
    documentId: 'doc_001',
    graphVersion: 7,
    nodeIds: expect.arrayContaining(['market', 'product', 'research', 'topic']),
  });
  await page.keyboard.press('Escape');

  const firstNode = page.locator('.react-flow__node').first();
  const firstNodeId = await firstNode.getAttribute('data-id');
  expect(firstNodeId).not.toBeNull();
  const initialProjection = await page.evaluate(async () => {
    const response = await fetch('/api/graph');
    return response.json();
  });
  const initialProjectedNode = initialProjection.nodes.find((node: { id: string }) => node.id === firstNodeId);
  expect(initialProjectedNode).toBeTruthy();
  const initialBox = await firstNode.boundingBox();
  expect(initialBox).not.toBeNull();
  const nodeCenter = {
    x: initialBox!.x + initialBox!.width / 2,
    y: initialBox!.y + initialBox!.height / 2,
  };
  await page.mouse.move(nodeCenter.x, nodeCenter.y);
  await page.mouse.down();
  await page.mouse.move(nodeCenter.x + 180, nodeCenter.y + 120, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel('Current selection')).toContainText('Display state saved outside canonical JSON.');
  const movedBox = await firstNode.boundingBox();
  expect(movedBox).not.toBeNull();
  expect(Math.round(movedBox!.x)).not.toBe(Math.round(initialBox!.x));
  const movedProjection = await page.evaluate(async () => {
    const response = await fetch('/api/graph');
    return response.json();
  });
  const movedProjectedNode = movedProjection.nodes.find((node: { id: string }) => node.id === firstNodeId);
  expect(movedProjectedNode.position).not.toEqual(initialProjectedNode.position);

  await page.reload();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  const reloadedProjection = await page.evaluate(async () => {
    const response = await fetch('/api/graph');
    return response.json();
  });
  const reloadedProjectedNode = reloadedProjection.nodes.find((node: { id: string }) => node.id === firstNodeId);
  expect(reloadedProjectedNode.position).toEqual(movedProjectedNode.position);
  expect(fileHash(sampleDocument)).toBe(beforeHash);
});

test('edits node text directly on the canvas and persists canonical JSON', async ({ page }) => {
  const staticEntry = path.join(repoRoot, 'webui', 'dist', 'index.html');
  if (!fs.existsSync(staticEntry)) {
    test.skip(true, 'Run npm run build before this e2e test so the sidecar can serve WebUI assets.');
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mindmap-webui-edit-'));
  const documentPath = path.join(tempRoot, 'sample-mindmap.json');
  const viewStateDir = path.join(tempRoot, 'view-state');
  fs.copyFileSync(sampleDocument, documentPath);
  const original = JSON.parse(fs.readFileSync(documentPath, 'utf8'));
  fs.mkdirSync(viewStateDir, { recursive: true });
  fs.writeFileSync(
    path.join(viewStateDir, 'doc_001.webui.json'),
    JSON.stringify(
      {
        documentId: 'doc_001',
        viewId: 'webui-default',
        positions: {},
        dimensions: {
          market: { width: 80, height: 40 },
          product: { width: 80, height: 40 },
          research: { width: 80, height: 40 },
          topic: { width: 80, height: 40 },
        },
        viewport: { x: 0, y: 0, zoom: 1 },
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  const handle = await startWebUIService({
    documentPath,
    viewStateDir,
    runtimePath: path.join(tempRoot, 'runtime', 'webui.json'),
  });

  try {
    await page.goto(handle.runtime.url);
    await expectNodeTextInsideNodes(page);
    const titleInput = page.getByLabel('Edit title for market');
    await expect(titleInput).toBeVisible();
    await titleInput.fill(longTitle);
    await titleInput.press('Enter');
    await expect(page.getByLabel('Current selection')).toContainText('Text edit saved to canonical JSON.');
    await expect(page.getByLabel('Edit title for market')).toHaveValue(longTitle);
    await expectNodeTextInsideNodes(page);

    const contentInput = page.getByLabel('Edit content for market');
    await contentInput.fill(longContent);
    await contentInput.evaluate((element) => (element as HTMLTextAreaElement).blur());
    await expect(page.getByLabel('Current selection')).toContainText('Text edit saved to canonical JSON.');
    await expect(page.getByLabel('Edit content for market')).toHaveValue(longContent);
    await expectNodeTextInsideNodes(page);

    const persisted = JSON.parse(fs.readFileSync(documentPath, 'utf8'));
    expect(persisted.metadata.graphVersion).toBe(original.metadata.graphVersion + 2);
    expect(persisted.graph.nodes.market.title).toBe(longTitle);
    expect(persisted.graph.nodes.market.cardContent).toBe(longContent);
  } finally {
    await handle.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

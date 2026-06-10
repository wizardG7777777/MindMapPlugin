import { expect, test } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..', '..');
const sampleDocument = path.join(repoRoot, 'samples', 'documents', 'sample-mindmap.json');

function fileHash(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    const response = await fetch('/api/selection', {
      headers: token ? { 'X-Mindmap-Token': token } : {},
    });
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
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    const response = await fetch('/api/graph', {
      headers: token ? { 'X-Mindmap-Token': token } : {},
    });
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
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    const response = await fetch('/api/graph', {
      headers: token ? { 'X-Mindmap-Token': token } : {},
    });
    return response.json();
  });
  const movedProjectedNode = movedProjection.nodes.find((node: { id: string }) => node.id === firstNodeId);
  expect(movedProjectedNode.position).not.toEqual(initialProjectedNode.position);

  await page.reload();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  const reloadedProjection = await page.evaluate(async () => {
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    const response = await fetch('/api/graph', {
      headers: token ? { 'X-Mindmap-Token': token } : {},
    });
    return response.json();
  });
  const reloadedProjectedNode = reloadedProjection.nodes.find((node: { id: string }) => node.id === firstNodeId);
  expect(reloadedProjectedNode.position).toEqual(movedProjectedNode.position);
  expect(fileHash(sampleDocument)).toBe(beforeHash);
});

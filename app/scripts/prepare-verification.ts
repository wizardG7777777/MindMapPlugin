import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGraph, serializeGraph } from '../src/model.ts';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
await mkdir(resolve(repo, 'test-results'), { recursive: true });
const destination = await mkdtemp(resolve(repo, 'test-results/html-manual-'));
await cp(resolve(repo, 'dist/html'), destination, { recursive: true });
const source = await readFile(resolve(destination, 'maps/minimal.html'), 'utf8');
for (const host of ['chrome', 'codex']) {
  const graph = parseGraph(source).graph!;
  graph.title = `${host} 文件流程验证`;
  graph.nodes[0].title = `${host} 初始图`;
  await writeFile(resolve(destination, `maps/${host}.html`), serializeGraph(graph));
}
console.log(JSON.stringify({ directory: destination, chrome: resolve(destination, 'maps/chrome.html'), codex: resolve(destination, 'maps/codex.html') }, null, 2));

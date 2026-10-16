import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { serializeGraph, RELEASE, type Graph } from '../src/model.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '../dist/html');
const runtime = resolve(output, 'runtime', RELEASE);
await mkdir(runtime, { recursive: true });
await build({ entryPoints: [resolve(root, 'src/app.tsx')], bundle: true, outfile: resolve(runtime, 'app.js'),
  platform: 'browser', format: 'iife', target: ['chrome120'], minify: true, legalComments: 'linked',
  loader: { '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' },
  define: { 'process.env.NODE_ENV': '"production"' } });
const graph: Graph = {
  lang: 'zh-CN', title: '最小图文件', classes: ['map', 'default'],
  resources: { css: [`../runtime/${RELEASE}/app.css`], scripts: [`../runtime/${RELEASE}/app.js`] },
  nodes: [{ id: 'node-1', classes: ['basic'], shape: 'round-rect', x: 0, y: 0,
    title: '最小图文件', card: '在页面中编辑，手动保存后写回这个 HTML。\n\n公式：$x^2 + y^2 = 1$。',
    notes: '这段笔记在收起时隐藏，但仍完整保存。', edges: [] }],
};
await mkdir(resolve(output, 'maps'), { recursive: true });
// Generated samples are templates. Never overwrite a file used for an ongoing test.
await writeFile(resolve(output, 'maps/minimal.html'), serializeGraph(graph));
const packageReadme = await readFile(resolve(root, 'PACKAGE-README.md'), 'utf8');
await writeFile(resolve(output, 'README.md'), packageReadme.replaceAll('{{RELEASE}}', RELEASE));
const manifest: Record<string, unknown> = { release: RELEASE, format: 'mindmap/1', transport: 'local relative classic script', files: {} };
for (const filename of ['app.js', 'app.css']) {
  const bytes = await readFile(resolve(runtime, filename));
  (manifest.files as Record<string, unknown>)[filename] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await writeFile(resolve(runtime, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Built ${output}; sample: maps/minimal.html`);

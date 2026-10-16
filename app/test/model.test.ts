import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGraph, serializeGraph, finishNode, RELEASE, type Graph } from '../src/model.ts';
import { checkSource } from '../src/check-source.ts';

function fixture(): Graph {
  return { lang: 'zh-CN', title: 'Graph & title', classes: ['map', 'default'],
    resources: { css: [`../runtime/${RELEASE}/app.css`], scripts: [`../runtime/${RELEASE}/app.js`] },
    nodes: [
      { id: 'A', title: '中文 😀 <script>literal</script>', card: '| A | B |\n| - | - |\n| 1 | $x$ |', notes: 'hidden\n& < > "', classes: ['basic'], shape: 'diamond', x: -5, y: 1.5,
        edges: [{ id: 'e1', target: 'A', label: '**plain**', kind: 'bezier', start: [1, 0.25] }, { id: 'e2', target: 'B', label: '', kind: 'straight' }, { id: 'e3', target: 'B', label: 'parallel', kind: 'orthogonal' }] },
      { id: 'B', title: 'B', card: '', notes: 'keep', classes: ['basic'], shape: 'circle', x: 500, y: 0, edges: [{ id: 'e4', target: 'A', label: 'cycle', kind: 'bezier' }] },
    ] };
}
test('source round trip preserves Unicode, Markdown, hidden notes, cycles, parallel edges and resources', () => {
  const graph = fixture();
  const source = serializeGraph(graph);
  assert.match(source, /&lt;script&gt;literal&lt;\/script&gt;/);
  const result = parseGraph(source);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.graph, graph);
  assert.equal(serializeGraph(result.graph!), source);
  assert.doesNotMatch(source, /textarea|mindmap-editor|<svg|data-z|data-type/);
});
test('disk truncation counts code points while read-only validation reports original length', () => {
  const original = serializeGraph(fixture()).replace('中文 😀 &lt;script&gt;literal&lt;/script&gt;', '😀'.repeat(1025));
  const loaded = parseGraph(original), checked = parseGraph(original, false);
  assert.equal(Array.from(loaded.graph!.nodes[0].title).length, 1024);
  assert.equal(Array.from(checked.graph!.nodes[0].title).length, 1025);
  assert.match(checked.diagnostics[0].message, /1025.*1024/);
});
test('duplicate node handling preserves first node and incoming links, removes dangling targets', () => {
  const source = serializeGraph(fixture()).replace('</section>', '<article id="A"><h2 class="title">duplicate</h2><div class="card"></div><div class="notes"></div><ul class="links"></ul></article></section>');
  const result = parseGraph(source);
  assert.equal(result.graph!.nodes.length, 2);
  assert.equal(result.graph!.nodes[1].edges[0].target, 'A');
  const invalid = parseGraph(source.replace('href="#B"', 'href="#missing"'));
  assert.equal(invalid.graph!.nodes[0].edges.length, 2);
});
test('empty title swaps card or removes only node and all incident edges', () => {
  const graph = fixture();
  assert.equal(finishNode(graph, 'A', { title: ' ', card: 'becomes title', notes: 'hidden' }), true);
  assert.equal(graph.nodes[0].title, 'becomes title');
  assert.equal(graph.nodes[0].card, ' ');
  assert.equal(finishNode(graph, 'A', { title: '', card: '', notes: 'notes do not prevent deletion' }), false);
  assert.equal(graph.nodes[0].id, 'B'); assert.deepEqual(graph.nodes[0].edges, []);
  finishNode(graph, 'B', { title: '', card: '', notes: '' });
  assert.deepEqual(parseGraph(serializeGraph(graph)).graph!.nodes, []);
});
test('unrecognized document is not treated as an empty graph; syntax errors remain diagnostic', () => {
  assert.equal(parseGraph('<html><body>not a map</body></html>').graph, null);
  const source = serializeGraph(fixture()).replace('content="mindmap/1"', 'content="mindmap/9"');
  assert.equal(parseGraph(source).graph, null);
  const broken = serializeGraph(fixture()).replace('</article>', '');
  assert.ok(parseGraph(broken).diagnostics.length);
});
test('read-only checker measures every original duplicate and does not repair missing positions', () => {
  const source = serializeGraph(fixture()).replace('</section>', `<article id="A"><h2 class="title">${'😀'.repeat(1030)}</h2><div class="card"></div><div class="notes"></div><ul class="links"></ul></article></section>`);
  const result = checkSource(source);
  assert.equal(result.valid, false); assert.equal(result.nodes, 3);
  assert.deepEqual(result.fields.filter(f => f.object === 'A' && f.field === 'title').map(f => [f.occurrence, f.length, f.excess]), [[1, 29, 0], [3, 1030, 6]]);
  assert.ok(!result.diagnostics.some(d => d.field === 'position'));
});

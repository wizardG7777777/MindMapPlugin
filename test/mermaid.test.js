import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { cli,workspace,request } from './helpers/cli.js';
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window; globalThis.document = dom.window.document;
const {default:mermaid} = await import('mermaid');
mermaid.initialize({startOnLoad:false,securityLevel:'strict'});

test('C05: pinned Mermaid parser preserves cycles, self-loops, parallel edges and unsafe labels',async t => {
  const {dir,doc} = await workspace(t);
  for (const orientation of ['LR','TD']) {
    const context = (await cli(['context',doc,'--all','--mermaid','--orientation',orientation])).data;
    assert.ok(await mermaid.parse(context.mermaid.text));
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(context.mermaid.text);
    const vertices = diagram.db.getVertices(), edges = diagram.db.getEdges();
    assert.equal(vertices.size,4); assert.equal(edges.length,6);
    assert.deepEqual(edges.map(e => [context.mermaid.nodeIds[e.start],context.mermaid.nodeIds[e.end]]),context.edges.map(e => [e.source,e.target]));
    assert.deepEqual(context.mermaid.edgeIds.map(e => e.edgeId),context.edges.map(e => e.id));
    assert.ok(context.mermaid.text.startsWith('flowchart '+orientation+'\n'));
  }
  const unsafe = 'A " & # <script>alert(1)</script> [ ] { } | \\ `\nend\tclick n_0 "https://example.invalid"';
  const file = await request(dir,[{type:'updateNode',nodeId:'a',patch:{title:unsafe}},{type:'updateEdge',edgeId:'ca',patch:{kind:unsafe,order:12}}]);
  await cli(['apply',doc,'--input',file]);
  const output = (await cli(['context',doc,'--all','--mermaid','--content','all'])).data;
  assert.ok(await mermaid.parse(output.mermaid.text));
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(output.mermaid.text);
  assert.equal(diagram.db.getVertices().size,4); assert.equal(diagram.db.getEdges().length,6);
  assert.ok(!output.mermaid.text.includes('<script>')); assert.ok(output.mermaid.text.includes('#60;script#62;'));
  assert.ok(!output.mermaid.text.split('\n').some(line => /^\s*click\s/.test(line)));
  assert.equal(output.mermaid.edgeIds.at(-1).order,12);
  const repeat = (await cli(['context',doc,'--all','--mermaid','--content','all'])).data;
  assert.deepEqual(repeat.mermaid,output.mermaid);
});

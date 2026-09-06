import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { JSDOM } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';
import { cli, bin, packageRoot, ajv, unchanged } from './helpers/cli.js';
const exec = promisify(execFile);
const layoutSchema = JSON.parse(await fs.readFile(join(packageRoot, 'schemas/layout.json'), 'utf8'));
const checkLayout = ajv.compile(layoutSchema);
const load = name => fs.readFile(join(packageRoot, 'samples/documents', name + '.json'), 'utf8').then(JSON.parse);
async function local(t, data) {
  const dir = await fs.mkdtemp('/private/tmp/mindmap visual ');
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'document.json'); await fs.writeFile(path, JSON.stringify(data));
  return { dir, path };
}
const collides = (a, b) => a.x + 0.05 < b.x + b.width && a.x + a.width > b.x + 0.05 && a.y + 0.05 < b.y + b.height && a.y + a.height > b.y + 0.05;
const center = (node, axis) => node[axis] + node[axis === 'x' ? 'width' : 'height'] / 2;
function checkGeometry(data, graph) {
  const scene = data.layout;
  assert.ok(checkLayout(scene), JSON.stringify(checkLayout.errors));
  assert.deepEqual(scene.nodes.map(n => n.id).sort(), Object.keys(graph.nodes).sort());
  assert.deepEqual(scene.edges.map(e => e.id).sort(), Object.keys(graph.edges).sort());
  for (let i = 0; i < scene.nodes.length; i++) {
    const a = scene.nodes[i];
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.width <= scene.width && a.y + a.height <= scene.height);
    for (const b of scene.nodes.slice(i + 1)) assert.equal(collides(a, b), false, `overlapping nodes ${a.id}/${b.id}`);
  }
  for (const edge of scene.edges) {
    assert.equal(edge.source, graph.edges[edge.id].source); assert.equal(edge.target, graph.edges[edge.id].target);
    for (const p of edge.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= scene.width && p.y <= scene.height);
    for (const n of scene.nodes) assert.equal(collides(edge.label, n), false, `label ${edge.id} covers ${n.id}`);
    for(let i=1;i<edge.points.length;i++) {
      const a=edge.points[i-1],b=edge.points[i],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/8));
      for(let step=1;step<steps;step++) {
        const x=a.x+(b.x-a.x)*step/steps,y=a.y+(b.y-a.y)*step/steps;
        for(const n of scene.nodes) if(n.id!==edge.source && n.id!==edge.target) assert.ok(!(x>n.x+1 && x<n.x+n.width-1 && y>n.y+1 && y<n.y+n.height-1),`${edge.id} crosses node ${n.id}`);
      }
    }

  }
  for (let i = 0; i < scene.edges.length; i++) for (const e of scene.edges.slice(i + 1)) assert.equal(collides(scene.edges[i].label, e.label), false, 'labels overlap');
  const xml = new JSDOM(data.text, { contentType: 'image/svg+xml' }).window.document;
  assert.equal(xml.querySelectorAll('g[data-node-id]').length, scene.nodes.length);
  assert.equal(xml.querySelectorAll('g[data-edge-id]').length, scene.edges.length);
  for (const element of xml.querySelectorAll('[href]')) assert.ok(element.getAttribute('href').startsWith('#'), 'SVG contains an external resource');
  assert.equal(xml.querySelectorAll('script,foreignObject,image').length, 0);
  const png = new Resvg(data.text, { fitTo: { mode: 'width', value: 1000 } }).render().asPng();
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 1000);
}

test('V01/V02: login entry, equal alternative ranks, merge and forward progress in both directions', async t => {
  const document = await load('login-flow'); const { dir, path } = await local(t, document);
  for (const orientation of ['TD', 'LR']) {
    const result = await unchanged(path, () => cli(['render', path, '--format', 'svg', '--orientation', orientation]));
    const data = result.data; checkGeometry(data, document.graph);
    const scene = data.layout, map = new Map(scene.nodes.map(n => [n.id, n]));
    const axis = orientation === 'TD' ? 'y' : 'x';
    assert.equal(scene.profile, 'flowchart'); assert.equal(scene.entryNodeId, 'login_ui');
    for (const ids of [['a_input', 'b_authorize', 'c_authorize'], ['a_verify', 'b_verify', 'c_verify']]) {
      for (const id of ids) assert.ok(Math.abs(center(map.get(id), axis) - center(map.get(ids[0]), axis)) < 0.01, 'alternative layers are misaligned');
      assert.equal(new Set(ids.map(id => center(map.get(id), axis === 'x' ? 'y' : 'x'))).size, 3);
    }
    assert.equal(Math.min(...scene.nodes.map(n => center(n, axis))), center(map.get('login_ui'), axis));
    for (const id of scene.constraints.forwardEdgeIds) {
      const edge = document.graph.edges[id]; assert.ok(center(map.get(edge.source), axis) < center(map.get(edge.target), axis), id + ' runs backward');
    }
    assert.deepEqual(scene.constraints.retryEdgeIds.sort(), ['e07', 'e10', 'e20', 'e24', 'e27', 'e31', 'e33']);
    assert.ok(center(map.get('resolve_account'), axis) > center(map.get('a_verify'), axis));
    assert.ok(center(map.get('main_ui'), axis) > center(map.get('load_context'), axis));
  }
  assert.deepEqual(await fs.readdir(dir), ['document.json'], 'Rendering created session/lock state');
});

test('V03: all five actual layout strategies preserve every relationship and rasterize', async t => {
  const pictures = new Map();
  for (const profile of ['mindmap', 'dependency', 'network', 'fishbone']) {
    const document = await load('layout-' + profile); const { path } = await local(t, document);
    const result = await cli(['render', path, '--format', 'svg']);
    assert.equal(result.data.layout.profile, profile); checkGeometry(result.data, document.graph);
    const scene = result.data.layout; pictures.set(profile, scene.nodes.map(n => [n.x, n.y]));
    if (profile === 'dependency') {
      assert.ok(scene.groups.some(g => g.kind === 'cycle' && g.nodeIds.includes('layout') && g.nodeIds.includes('metrics')));
      const nodes = new Map(scene.nodes.map(n => [n.id, n]));
      for (const id of scene.constraints.forwardEdgeIds) { const e = document.graph.edges[id]; assert.ok(nodes.get(e.source).rank < nodes.get(e.target).rank); }
      const group=scene.groups.find(g=>g.kind==='cycle'),members=scene.nodes.filter(n=>group.nodeIds.includes(n.id));
      const box={x:Math.min(...members.map(n=>n.x))-18,y:Math.min(...members.map(n=>n.y))-18};
      box.width=Math.max(...members.map(n=>n.x+n.width))-box.x+18;box.height=Math.max(...members.map(n=>n.y+n.height))-box.y+18;
      for(const edge of scene.edges.filter(e=>!group.nodeIds.includes(e.source)&&!group.nodeIds.includes(e.target))) for(let i=1;i<edge.points.length;i++) {
        const a=edge.points[i-1],b=edge.points[i],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/6));
        for(let j=1;j<steps;j++){const x=a.x+(b.x-a.x)*j/steps,y=a.y+(b.y-a.y)*j/steps;assert.ok(!(x>box.x&&x<box.x+box.width&&y>box.y&&y<box.y+box.height),'An unrelated dependency edge crosses the cycle group');}
      }

    }
    if (profile === 'mindmap') assert.ok(scene.edges.some(e => e.source === e.target && e.role === 'cross'));
    if (profile === 'fishbone') {
      const effect = scene.nodes.find(n => n.id === 'effect'); const middle = center(effect, 'y');
      assert.ok(scene.nodes.some(n => center(n, 'y') < middle)); assert.ok(scene.nodes.some(n => center(n, 'y') > middle));
      assert.ok(scene.edges.some(e => e.points.some((p, i) => i && p.x !== e.points[i - 1].x && p.y !== e.points[i - 1].y)), 'No diagonal bones');
      assert.equal(Math.max(...scene.nodes.map(n => center(n, 'x'))), center(effect, 'x'));
    }
  }
  assert.equal(new Set([...pictures.values()].map(JSON.stringify)).size, 4);
});

test('V04: semantic layout is stable when canonical IDs are renamed adversarially', async t => {
  const document = await load('login-flow'); const renamed = structuredClone(document);
  const ids = Object.keys(document.graph.nodes), mapping = new Map(ids.map((id, i) => [id, 'renamed-' + (ids.length - i)]));
  renamed.graph.entryNodeId = mapping.get(document.graph.entryNodeId);
  renamed.graph.nodes = Object.fromEntries(Object.values(renamed.graph.nodes).map(n => {
    n.id = mapping.get(n.id); if (n.meta.flow?.mergeNodeId) n.meta.flow.mergeNodeId = mapping.get(n.meta.flow.mergeNodeId); return [n.id, n];
  }));
  for (const e of Object.values(renamed.graph.edges)) { e.source = mapping.get(e.source); e.target = mapping.get(e.target); }
  const a = await local(t, document), b = await local(t, renamed);
  const first = (await cli(['render', a.path, '--format', 'svg'])).data.layout;
  const second = (await cli(['render', b.path, '--format', 'svg'])).data.layout;
  for (const n of first.nodes) {
    const other = second.nodes.find(o => o.id === mapping.get(n.id));
    assert.equal(n.rank, other.rank); assert.equal(n.x, other.x); assert.equal(n.y, other.y);
  }
});

test('V05: standalone Mermaid source, optional hints, context hints and native parser', async t => {
  const document = await load('login-flow'), { path } = await local(t, document);
  const dom = new JSDOM('<!doctype html><html><body></body></html>'); globalThis.window = dom.window; globalThis.document = dom.window.document;
  const { default: mermaid } = await import('mermaid'); mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
  for (const hints of [false, true]) {
    const args = ['render', path, '--format', 'mermaid', ...(hints ? ['--layout-hints'] : [])];
    const result = await cli(args);
    assert.equal(Boolean(result.data.layoutHints), hints); assert.equal(result.data.layout, null);
    assert.ok(await mermaid.parse(result.data.text));
    const diagram = await mermaid.mermaidAPI.getDiagramFromText(result.data.text);
    assert.equal(diagram.db.getVertices().size, 22); assert.equal(diagram.db.getEdges().length, 34);
    const raw = await exec(process.execPath, [bin, ...args, '--raw'], { maxBuffer: 10 * 1024 * 1024 });
    assert.equal(raw.stdout, result.data.text); assert.equal(raw.stderr, '');
    if (hints) {
      const comment = result.data.text.split('\n').find(l => l.startsWith('%% mindmap-layout-v1: '));
      assert.deepEqual(JSON.parse(comment.slice('%% mindmap-layout-v1: '.length)), result.data.layoutHints);
      assert.ok(result.data.text.includes('nodeSpacing: 60'));
    } else assert.ok(result.data.text.startsWith('flowchart TD\n'));
  }
  const context = await cli(['context', path, '--all', '--mermaid', '--layout-hints', '--layout', 'flowchart', '--orientation', 'TD']);
  assert.ok(checkLayout(context.data.mermaid.layoutHints)); assert.ok(await mermaid.parse(context.data.mermaid.text));
  const scoped = await cli(['context', path, '--nodes', 'choose_method', '--depth', '1', '--mermaid', '--layout-hints', '--layout', 'flowchart']);
  assert.ok(scoped.data.mermaid.layoutHints.warnings.some(w => w.code === 'MERGE_OUTSIDE_SCOPE'));
  assert.deepEqual(scoped.data.mermaid.layoutHints.nodes.map(n => n.id).sort(), scoped.data.nodes.map(n => n.id).sort());
});

test('V06: Unicode, XML safety, missing glyphs, valid raw SVG and artifact error streams', async t => {
  const document = await load('layout-network');
  document.graph.nodes.client.title = '中文 <script>alert("x")</script> & 😀\u0000';
  const { path } = await local(t, document);
  const result = await cli(['render', path, '--format', 'svg']); checkGeometry(result.data, document.graph);
  assert.ok(result.data.warnings.some(w => w.code === 'MISSING_GLYPH'));
  assert.ok(!result.data.text.includes('<script>'));
  const raw = await exec(process.execPath, [bin, 'render', path, '--format', 'svg', '--raw'], { maxBuffer: 10 * 1024 * 1024 });
  assert.equal(raw.stdout, result.data.text);
  for (const args of [['render', path, '--format', 'svg', '--layout-hints'], ['render', path, '--format', 'svg', '--raw', '--json'], ['render', path, '--format', 'nope'], ['context', path, '--all', '--layout-hints']]) {
    try { await exec(process.execPath, [bin, ...args, ...(!args.includes('--json') ? ['--raw'] : [])]); assert.fail('Invalid arguments succeeded'); }
    catch (error) { assert.equal(error.code, 2); if (!args.includes('--json') && args[0] === 'render') { assert.equal(error.stdout, ''); assert.equal(JSON.parse(error.stderr).error.code, 'INVALID_ARGUMENT'); } }
  }
});

test('V07: unsupported constraints and resource limits are explicit; empty SVG remains valid', async t => {
  const document = await load('login-flow');
  document.graph.nodes.choose_method.meta.flow.mergeNodeId = 'missing';
  const a = await local(t, document);
  await unchanged(a.path, async () => assert.equal((await cli(['render', a.path, '--format', 'svg'], { code: 3 })).error.code, 'INVALID_LAYOUT'));
  const empty = await load('empty-plan'); const b = await local(t, empty);
  checkGeometry((await cli(['render', b.path, '--format', 'svg'])).data, empty.graph);
  for (let i = 0; i < 501; i++) empty.graph.nodes['n' + i] = { id: 'n' + i, title: 'Node', cardContent: '', notes: '', meta: {} };
  const c = await local(t, empty); assert.equal((await cli(['render', c.path, '--format', 'svg'], { code: 3 })).error.code, 'LIMIT_EXCEEDED');
});

test('V02: nested choices and a one-step alternative keep their entrance layers', async t => {
  const document = await load('empty-plan');
  const roles = { start:'start', outer:'decision', inner:'decision', short:'action', left:'action', right:'action', innerMerge:'merge', outerMerge:'merge', end:'end' };
  document.graph.semanticType='flowchart'; document.graph.entryNodeId='start';
  document.graph.nodes=Object.fromEntries(Object.entries(roles).map(([id,role])=>[id,{id,title:id,cardContent:'',notes:'',meta:{flow:{role,...(id==='outer'?{mergeNodeId:'outerMerge'}:id==='inner'?{mergeNodeId:'innerMerge'}:{})}}}]));
  const es=[['start','outer'],['outer','inner'],['outer','short'],['inner','left'],['inner','right'],['left','innerMerge'],['right','innerMerge'],['innerMerge','outerMerge'],['short','outerMerge'],['outerMerge','end']];
  document.graph.edges=Object.fromEntries(es.map(([source,target],i)=>{const id='e'+i;return[id,{id,source,target,kind:'next',meta:{flow:{role:['outer','inner'].includes(source)?'branch':'forward'}}}]}));
  const {path}=await local(t,document); const output=(await cli(['render',path,'--format','svg'])).data; checkGeometry(output,document.graph);
  const byId=new Map(output.layout.nodes.map(n=>[n.id,n]));
  assert.equal(byId.get('inner').rank,byId.get('short').rank);
  assert.equal(byId.get('left').rank,byId.get('right').rank);
  assert.ok(byId.get('innerMerge').rank > byId.get('left').rank);
  assert.ok(byId.get('outerMerge').rank > byId.get('innerMerge').rank);
});

test('V03: selecting different profiles changes geometry for the same graph', async t => {
  const document = await load('layout-mindmap'), {path} = await local(t,document);
  const scenes=[];
  for (const layout of ['flowchart','mindmap','dependency','network','fishbone']) {
    const data=(await cli(['render',path,'--format','svg','--layout',layout])).data;
    checkGeometry(data,document.graph);
    scenes.push(JSON.stringify(data.layout.nodes.map(n=>[n.id,n.x,n.y]).sort()));
  }
  assert.equal(new Set(scenes).size,5);
});

test('V07: an explicit flow entry cannot silently appear after a forward predecessor', async t => {
  const document=await load('layout-dependency'); document.graph.semanticType='flowchart'; document.graph.entryNodeId='core';
  const {path}=await local(t,document);
  await unchanged(path,async()=>assert.equal((await cli(['render',path,'--format','svg'],{code:3})).error.code,'INVALID_LAYOUT'));
});

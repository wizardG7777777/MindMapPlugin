import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { cli,workspace,snapshot,request,nodes,edges,unchanged } from './helpers/cli.js';

test('C09: requested fields, byte-safe Unicode truncation and complete metadata',async t => {
  const {dir,doc} = await workspace(t);
  const title = '研究😀'; const notes = 'é😀中文\n'; const meta = {nested:{unicode:'全部',null:null},array:[true,2]};
  const file = await request(dir,[{type:'updateNode',nodeId:'a',patch:{title,cardContent:'',notes,meta}}]);
  await cli(['apply',doc,'--input',file]);
  const full = (await cli(['node',doc,'--id','a','--content','all','--max-text-bytes','0'])).data;
  assert.deepEqual(full.node,{id:'a',title,cardContent:'',notes,meta}); assert.deepEqual(full.omissions.fields,[]);
  const small = (await cli(['node',doc,'--id','a','--content','all','--max-text-bytes','4'])).data;
  assert.equal(small.node.title,'研'); assert.equal(small.node.notes,'é'); assert.deepEqual(small.node.meta,meta);
  assert.deepEqual(small.omissions.fields,[{nodeId:'a',field:'notes',reason:'text_limit',omittedBytes:Buffer.byteLength(notes)-2},{nodeId:'a',field:'title',reason:'text_limit',omittedBytes:Buffer.byteLength(title)-3}]);
  const titleOnly = (await cli(['node',doc,'--id','a','--content','title','--max-text-bytes','0'])).data;
  assert.deepEqual(Object.keys(titleOnly.node),['id','title']);
  assert.deepEqual(titleOnly.omissions.fields.map(f => [f.field,f.omittedBytes]),[['cardContent',0],['meta',Buffer.byteLength(JSON.stringify(meta))],['notes',Buffer.byteLength(notes)]]);
  await unchanged(doc,() => cli(['node',doc,'--id','a','--content','card']));
});

test('C10: traversal directions, edge seeds, all budgets and omission accounting',async t => {
  const {doc} = await workspace(t);
  const depth0 = (await cli(['context',doc,'--nodes','a'])).data;
  assert.deepEqual(nodes(depth0),['a']); assert.deepEqual(edges(depth0),['aa']);
  assert.deepEqual(depth0.boundaryEdges.map(e => e.id),['ab','ab2','ac','ca']); assert.equal(depth0.omissions.nodes,0);
  const incoming = (await cli(['context',doc,'--nodes','a','--direction','incoming','--depth','1'])).data;
  assert.deepEqual(nodes(incoming),['a','c']); assert.deepEqual(edges(incoming),['aa','ac','ca']);
  const both = (await cli(['context',doc,'--nodes','a','--direction','both','--depth','1'])).data;
  assert.deepEqual(nodes(both),['a','b','c']); assert.deepEqual(edges(both),['aa','ab','ab2','ac','bc','ca']);
  const bounded = (await cli(['context',doc,'--nodes','c','--depth','2','--max-nodes','2','--max-edges','1','--max-boundary-edges','1'])).data;
  assert.deepEqual(nodes(bounded),['a','c']); assert.deepEqual(edges(bounded),['aa']); assert.equal(bounded.omissions.nodes,1); assert.equal(bounded.omissions.edges,2); assert.equal(bounded.omissions.boundaryEdges,2);
  const edgeSeed = (await cli(['context',doc,'--edges','ca','--max-edges','1'])).data;
  assert.deepEqual(nodes(edgeSeed),['a','c']); assert.deepEqual(edges(edgeSeed),['ca']); assert.equal(edgeSeed.omissions.edges,2);
  const combined = (await cli(['context',doc,'--nodes','x','--edges','ca'])).data;
  assert.deepEqual(nodes(combined),['a','c','x']);
  const allSmall = (await cli(['context',doc,'--all','--max-nodes','2','--max-boundary-edges','0'])).data;
  assert.deepEqual(nodes(allSmall),['a','b']); assert.equal(allSmall.omissions.nodes,2); assert.equal(allSmall.boundaryEdges.length,0); assert.equal(allSmall.omissions.boundaryEdges,3);
  const missingKinds = (await cli(['context',doc,'--all','--kinds','absent'])).data;
  assert.deepEqual(nodes(missingKinds),['a','b','c','x']); assert.deepEqual(edges(missingKinds),[]);
  for (const args of [['--nodes','a,b,c','--max-nodes','2'],['--edges','ca','--max-nodes','1'],['--edges','ca,aa','--max-edges','1']]) {
    const result = await cli(['context',doc,...args],{code:3}); assert.equal(result.error.code,'LIMIT_EXCEEDED'); assert.ok(result.error.details.requiredMinimum > result.error.details.maximum);
  }
  assert.equal((await cli(['context',doc,'--edges','ca','--kinds','references'],{code:2})).error.code,'INVALID_ARGUMENT');
});

test('C14: untruncated export beyond node/edge budgets and exact append to a >1 MiB field',async t => {
  const {dir,doc} = await workspace(t,{build:false});
  // Valid external fixtures isolate read limits without 30,000 CLI setup calls.
  const data = await snapshot(doc);
  for (let i=0;i<10001;i++) { const id = 'n' + String(i).padStart(5,'0'); data.graph.nodes[id] = {id,title:id,cardContent:'',notes:'',meta:{}}; }
  data.graph.nodes.n00000.notes = 'a'.repeat(1048577);
  await fs.writeFile(doc,JSON.stringify(data));
  let exported = (await cli(['export',doc])).data.document;
  assert.equal(Object.keys(exported.graph.nodes).length,10001);
  const limited = (await cli(['context',doc,'--all','--max-nodes','10000','--content','title'])).data;
  assert.equal(limited.nodes.length,10000); assert.equal(limited.omissions.nodes,1);
  const full = (await cli(['node',doc,'--id','n00000','--content','all','--max-text-bytes','0'])).data;
  assert.equal(Buffer.byteLength(full.node.notes),1048577); assert.deepEqual(full.omissions.fields,[]);
  const file = await request(dir,[{type:'updateNode',nodeId:'n00000',patch:{notes:full.node.notes+'\nappended'}}],{baseGraphVersion:0});
  await cli(['apply',doc,'--input',file]);
  assert.equal((await snapshot(doc)).graph.nodes.n00000.notes,'a'.repeat(1048577)+'\nappended');
  const exportedPath = dir + '/export-as-operation.json'; await fs.writeFile(exportedPath,JSON.stringify(exported));
  assert.equal((await cli(['apply',doc,'--input',exportedPath],{code:2})).error.code,'INVALID_ENVELOPE');
  // Separate graph for 20,001 parallel edges, preserving the complete records.
  const edgeDoc = dir + '/parallel.json'; const parallel = await snapshot(doc);
  parallel.graph.nodes = {a:{id:'a',title:'A',cardContent:'',notes:'',meta:{}},b:{id:'b',title:'B',cardContent:'',notes:'',meta:{}}};
  parallel.graph.edges = {};
  for (let i=0;i<20001;i++) { const id='e'+String(i).padStart(5,'0'); parallel.graph.edges[id]={id,source:'a',target:'b',kind:'next',meta:{}}; }
  await fs.writeFile(edgeDoc,JSON.stringify(parallel));
  exported = (await cli(['export',edgeDoc])).data.document; assert.equal(Object.keys(exported.graph.edges).length,20001);
  const edgesLimited = (await cli(['context',edgeDoc,'--all','--max-edges','20000'])).data; assert.equal(edgesLimited.edges.length,20000); assert.equal(edgesLimited.omissions.edges,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { cli,bin,packageRoot,workspace,snapshot,request,unchanged,nodes,edges,ajv,checkResult } from './helpers/cli.js';

test('C01: discovery, all help/schema outputs, exact command catalog and versions',async () => {
  const version = await cli(['--version']); assert.equal(version.data.version,'0.2.0');
  assert.equal(version.data.cliContractVersion,1); assert.deepEqual(version.data.documentSchemaVersions,[2]);
  const caps = (await cli(['capabilities'])).data;
  assert.deepEqual(caps.commands.map(c => c.name),['apply','capabilities','context','create','doctor','export','help','inspect','neighbors','node','preview','render','schema','validate','version']);
  assert.equal(caps.requiresServer,false); assert.deepEqual(caps.visualLayouts,['flowchart','mindmap','dependency','network','fishbone']);
  await cli(['--help']);
  for (const command of caps.commands) {
    if (!['version','help'].includes(command.name)) await cli([command.name,'--help']);
    assert.ok(ajv.validateSchema(command.inputSchema));
  }
  for (const name of ['document','operations','context','result','layout']) {
    const returned = (await cli(['schema',name])).data;
    assert.deepEqual(returned,JSON.parse(await fs.readFile(join(packageRoot,'schemas',name + '.json'),'utf8')));
    assert.ok(ajv.validateSchema(returned));
  }
});

test('C02-C04: empty creation, all graph structures, preview, three independent readers',async t => {
  const {dir,doc,batch} = await workspace(t,{build:false});
  assert.equal((await snapshot(doc)).metadata.graphVersion,0);
  const empty = (await cli(['context',doc,'--all'])).data;
  assert.deepEqual(nodes(empty),[]); assert.deepEqual(edges(empty),[]);
  await unchanged(doc,async () => assert.equal((await cli(['create',doc],{code:3})).error.code,'ALREADY_EXISTS'));
  const prediction = await unchanged(doc,() => cli(['preview',doc,'--input',batch]));
  assert.equal(prediction.data.operationCount,11); assert.equal(prediction.data.nextGraphVersion,1);
  assert.deepEqual(prediction.data.affectedNodeIds,['a','b','c','x']); assert.deepEqual(prediction.data.affectedEdgeIds,['aa','ab','ab2','ac','bc','ca']);
  const commit = await cli(['apply',doc,'--input',batch]); assert.equal(commit.graphVersion,1);
  assert.equal(commit.data.receipt.summary.operationCount,11);
  const beforeFiles = await fs.readdir(dir,{recursive:true});
  await unchanged(doc,async () => {
    const results = await Promise.all([
      cli(['node',doc,'--id','x','--content','title']),
      cli(['neighbors',doc,'--id','c','--direction','incoming','--kinds','next']),
      cli(['context',doc,'--nodes','a','--depth','2','--kinds','next','--mermaid']),
    ]);
    assert.deepEqual(results.map(r => r.graphVersion),[1,1,1]);
    assert.equal(results[0].data.node.id,'x');
    assert.deepEqual(nodes(results[1].data),['b','c']); assert.deepEqual(edges(results[1].data),['bc']);
    assert.deepEqual(results[1].data.boundaryEdges.map(e => e.id),['ab','ca']);
    assert.deepEqual(nodes(results[2].data),['a','b','c']); assert.deepEqual(edges(results[2].data),['aa','ab','bc','ca']);
  });
  assert.deepEqual(await fs.readdir(dir,{recursive:true}),beforeFiles);
  const all = (await cli(['context',doc,'--all'])).data;
  assert.deepEqual(nodes(all),['a','b','c','x']); assert.deepEqual(edges(all),['aa','ab','ab2','ac','bc','ca']);
  const inspection = (await cli(['inspect',doc])).data; assert.equal(inspection.nodeCount,4); assert.equal(inspection.edgeCount,6);
  assert.deepEqual(inspection.relationCounts,{'next':4,'references':1,'depends-on':1});
  await cli(['validate',doc]);
});

test('C06: every operation, shallow metadata, order, entry changes and removals',async t => {
  const {dir,doc} = await workspace(t);
  const changes = await request(dir,[
    {type:'updateNode',nodeId:'a',patch:{title:'  研究  ',meta:{keep:1},notes:'verbatim\n'}},
    {type:'updateNode',nodeId:'a',patch:{meta:{replace:2}}},
    {type:'updateEdge',edgeId:'ab',patch:{source:'x',target:'c',kind:' informs ',order:20,meta:{why:'test'}}},
    {type:'updateEdge',edgeId:'ab',patch:{order:null}},
    {type:'reorderEdges',source:'a',kind:'next',edgeIds:['aa']},
    {type:'updateDocument',patch:{title:' 新标题 ',semanticType:'custom graph'}},
    {type:'setEntryNode',nodeId:'x'},
    {type:'removeNode',nodeId:'b',edgePolicy:'removeIncidentEdges'},
    {type:'removeEdge',edgeId:'ca'},
  ],{actor:{kind:'agent',name:'Kimi'}});
  const before = (await snapshot(doc));
  const preview = (await unchanged(doc,() => cli(['preview',doc,'--input',changes]))).data;
  assert.equal(preview.summary.operationCount,9); assert.deepEqual(preview.affectedNodeIds,['a','b','c','x']);
  await cli(['apply',doc,'--input',changes]);
  const stored = await snapshot(doc);
  assert.equal(stored.metadata.graphVersion,2); assert.equal(stored.metadata.createdAt,before.metadata.createdAt);
  assert.equal(stored.metadata.title,'新标题'); assert.equal(stored.graph.semanticType,'custom graph');
  assert.deepEqual(stored.graph.nodes.a.meta,{replace:2}); assert.equal(stored.graph.nodes.a.title,'研究');
  assert.equal(stored.graph.edges.ab.order,undefined); assert.equal(stored.graph.edges.aa.order,0);
  assert.deepEqual(Object.keys(stored.graph.nodes).sort(),['a','c','x']);
  assert.equal(stored.graph.edges.bc,undefined); assert.equal(stored.graph.edges.ab2,undefined); assert.equal(stored.graph.entryNodeId,'x');
  assert.equal(stored.commits[1].actor.name,'Kimi');
  const removeAll = await request(dir,[...['a','c','x'].map(nodeId => ({type:'removeNode',nodeId,edgePolicy:'removeIncidentEdges'})),{type:'setEntryNode',nodeId:null}],{baseGraphVersion:2});
  await cli(['apply',doc,'--input',removeAll]);
  assert.deepEqual((await snapshot(doc)).graph.nodes,{}); assert.deepEqual((await snapshot(doc)).graph.edges,{});
});

test('C07/C08: invalid operations and every indirect/intermediate scope effect are atomic',async t => {
  const {dir,doc} = await workspace(t);
  const cases = [
    [[{type:'addNode',node:{id:'a',title:'duplicate'}}],{},'INVALID_OPERATION'],
    [[{type:'updateNode',nodeId:'missing',patch:{title:'x'}}],{},'INVALID_OPERATION'],
    [[{type:'addEdge',edge:{id:'new',source:'a',target:'missing',kind:'next'}}],{},'INVALID_OPERATION'],
    [[{type:'updateNode',nodeId:'a',patch:{}}],{},'INVALID_ENVELOPE'],
    [[{type:'updateNode',nodeId:'a',patch:{title:' \t'}}],{},'INVALID_ENVELOPE'],
    [[{type:'updateEdge',edgeId:'ab',patch:{order:-1}}],{},'INVALID_ENVELOPE'],
    [[{type:'removeNode',nodeId:'a',edgePolicy:'removeIncidentEdges'}],{},'INVALID_OPERATION'],
    [[{type:'reorderEdges',source:'a',kind:'next',edgeIds:['aa']}],{},'INVALID_OPERATION'],
    [[{type:'updateNode',nodeId:'a',patch:{title:'x'}}],{scope:{mode:'ids',nodeIds:[],edgeIds:[],allowDelete:false}},'SCOPE_VIOLATION'],
    [[{type:'addNode',node:{id:'new',title:'x'}}],{scope:{mode:'ids',nodeIds:['a'],edgeIds:[],allowDelete:false}},'SCOPE_VIOLATION'],
    [[{type:'updateEdge',edgeId:'ab',patch:{target:'c'}}],{scope:{mode:'ids',nodeIds:['a','b'],edgeIds:['ab'],allowDelete:false}},'SCOPE_VIOLATION'],
    [[{type:'removeNode',nodeId:'b',edgePolicy:'removeIncidentEdges'}],{scope:{mode:'ids',nodeIds:['a','b','c'],edgeIds:['ab','bc'],allowDelete:true}},'SCOPE_VIOLATION'],
    [[{type:'reorderEdges',source:'a',kind:'next',edgeIds:['ab','aa']}],{scope:{mode:'ids',nodeIds:['a'],edgeIds:['ab','aa'],allowDelete:false}},'SCOPE_VIOLATION'],
    [[{type:'removeNode',nodeId:'x',edgePolicy:'removeIncidentEdges'},{type:'addNode',node:{id:'x',title:'Independent idea'}}],{scope:{mode:'document',allowDelete:false}},'SCOPE_VIOLATION'],
    [[{type:'setEntryNode',nodeId:null}],{scope:{mode:'ids',nodeIds:['a'],edgeIds:[],allowDelete:false}},'SCOPE_VIOLATION'],
    [[{type:'updateDocument',patch:{title:'x'}}],{scope:{mode:'ids',nodeIds:['a'],edgeIds:[],allowDelete:false}},'SCOPE_VIOLATION'],
    [[{type:'removeEdge',edgeId:'aa'}],{scope:{mode:'document',allowDelete:false}},'SCOPE_VIOLATION'],
  ];
  for (const [ops,options,expected] of cases) {
    const file = await request(dir,ops,options);
    await unchanged(doc,async () => {const r = await cli(['apply',doc,'--input',file],{code:expected === 'INVALID_ENVELOPE' ? 2 : 3}); assert.equal(r.error.code,expected);});
  }
  const cancel = await request(dir,[{type:'updateNode',nodeId:'a',patch:{title:'Changed'}},{type:'updateNode',nodeId:'a',patch:{title:'Research'}}]);
  const prediction = (await cli(['preview',doc,'--input',cancel])).data;
  assert.deepEqual(prediction.diff.nodes,[]); assert.deepEqual(prediction.affectedNodeIds,['a']);
  await cli(['apply',doc,'--input',cancel]); assert.equal((await snapshot(doc)).metadata.graphVersion,2);
});

test('C11/C12: parser failures, missing records, byte-exact stdin and readable output',async t => {
  const {dir,doc} = await workspace(t);
  for (const args of [['bogus'],['node',doc],['context',doc],['context',doc,'--all','--nodes','a'],['context',doc,'--all','--depth','0'],['context',doc,'--nodes','a,a'],['context',doc,'--nodes','a,'],['context',doc,'--all','--content','wrong'],['context',doc,'--all','--orientation','TD'],['node',doc,'--id','a','--id','b'],['inspect',doc,'--mcp'],['neighbors',doc,'--id','a','--depth','1'],['create',join(dir,'unused'),'--lock-timeout-ms','1.5']]) {
    assert.equal((await cli(args,{code:2})).error.code,'INVALID_ARGUMENT');
  }
  for (const args of [['node',doc,'--id','missing'],['context',doc,'--edges','missing'],['inspect',doc,'--operation-id','missing']]) assert.equal((await cli(args,{code:3})).error.code,'NOT_FOUND');
  const file = await request(dir,[{type:'updateNode',nodeId:'a',patch:{notes:'stdin exact'}}]);
  async function raw(args,input) {
    return new Promise((resolve,reject) => {
      const child = spawn(process.execPath,[bin,...args],{stdio:['pipe','pipe','pipe']});
      let out='',err=''; child.stdout.on('data',s => out += s); child.stderr.on('data',s => err += s); child.on('error',reject);
      child.on('close',code => resolve({code,out,err})); child.stdin.end(input);
    });
  }
  const bytes = await fs.readFile(file);
  const first = await raw(['apply',doc,'--input','-','--json'],bytes); assert.equal(first.code,0,first.out);
  const second = await raw(['apply',doc,'--input','-'],bytes); assert.equal(second.code,0,second.out);
  const result = JSON.parse(second.out); assert.ok(checkResult(result)); assert.equal(result.data.replayed,true);
  assert.equal(result.graphVersion,2); assert.equal(second.err,'');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { cli,workspace,snapshot,request,unchanged } from './helpers/cli.js';

test('C07: strict UTF-8/JSON, duplicate escaped keys, closed schemas and version errors',async t => {
  const {dir,doc,batch} = await workspace(t);
  const valid = await fs.readFile(batch,'utf8');
  const base = JSON.parse(valid);
  const cases = [
    [Buffer.from([0xff,0xfe]),'INVALID_JSON'], ['{"x":1,"x":2}','INVALID_JSON'], ['{"x":1,"\\u0078":2}','INVALID_JSON'], ['{"n":1e400}','INVALID_JSON'], ['[] trailing','INVALID_JSON'],
    [JSON.stringify({...base,extra:true}),'INVALID_ENVELOPE'], [JSON.stringify({...base,envelopeVersion:2}),'INVALID_ENVELOPE'],
    [JSON.stringify({...base,documentId:'other'}),'INVALID_ENVELOPE'],
    [JSON.stringify({...base,operations:[]}),'INVALID_ENVELOPE'],
    [JSON.stringify({...base,baseGraphVersion:1.5}),'INVALID_ENVELOPE'],
    [JSON.stringify({...base,baseGraphVersion:Number.MAX_SAFE_INTEGER+1}),'INVALID_ENVELOPE'],
    [JSON.stringify({...base,operations:[{type:'addNode',node:{id:'z',title:'Z',position:{x:1,y:1}}}]}),'INVALID_ENVELOPE'],
    [JSON.stringify({...base,scope:{mode:'ids',nodeIds:[],edgeIds:[]}}),'INVALID_ENVELOPE'],
  ];
  for (const [bytes,expected] of cases) {
    const file = join(dir,'bad-input.json'); await fs.writeFile(file,bytes);
    await unchanged(doc,async () => assert.equal((await cli(['apply',doc,'--input',file],{code:2})).error.code,expected));
  }
  const original = await snapshot(doc);
  const corruptions = [
    [d => d['JSON-SchemaVersion']=1,'UNSUPPORTED_SCHEMA',3],
    [d => d.metadata.graphVersion=9,'INVALID_DOCUMENT',3],
    [d => d.graph.nodes.a.id='other','INVALID_DOCUMENT',3],
    [d => d.graph.edges.ab.source='missing','INVALID_DOCUMENT',3],
    [d => d.graph.entryNodeId='missing','INVALID_DOCUMENT',3],
    [d => d.graph.nodes.a.extra=1,'INVALID_DOCUMENT',3],
    [d => d.commits[0].committedGraphVersion=2,'INVALID_DOCUMENT',3],
    [d => d.commits[0].affectedNodeIds.reverse(),'INVALID_DOCUMENT',3],
    [d => d.commits[0].summary.nodeCount=1,'INVALID_DOCUMENT',3],
    [d => d.metadata.updatedAt=d.metadata.createdAt,'INVALID_DOCUMENT',3],
    [d => d.metadata.createdAt='2026-02-31T00:00:00.000Z','INVALID_DOCUMENT',3],
    [d => d.graph.edges.ab.order=Number.MAX_SAFE_INTEGER+1,'INVALID_DOCUMENT',3],
  ];
  for (const [mutate,expected,code] of corruptions) {
    const d = structuredClone(original); mutate(d); const path = join(dir,'bad-document.json'); await fs.writeFile(path,JSON.stringify(d));
    await unchanged(path,async () => assert.equal((await cli(['validate',path],{code})).error.code,expected));
  }
  const bad = join(dir,'bad-bytes.json'); await fs.writeFile(bad,'{"JSON-SchemaVersion":2,"JSON-SchemaVersion":2}');
  assert.equal((await cli(['validate',bad],{code:2})).error.code,'INVALID_JSON');
  assert.equal((await cli(['create',bad],{code:3})).error.code,'ALREADY_EXISTS');
});

test('P09: byte/count limits, oversized candidate with receipts, and bounded file reads',async t => {
  const {dir,doc} = await workspace(t);
  const hugeInput = join(dir,'huge-input.json'); await fs.writeFile(hugeInput,' '.repeat(8388609));
  await unchanged(doc,async () => assert.equal((await cli(['apply',doc,'--input',hugeInput],{code:3})).error.code,'LIMIT_EXCEEDED'));
  const many = await request(dir,Array.from({length:10001},() => ({type:'updateNode',nodeId:'a',patch:{title:'A'}})));
  await unchanged(doc,async () => assert.equal((await cli(['apply',doc,'--input',many],{code:3})).error.code,'LIMIT_EXCEEDED'));
  const hugeDoc = join(dir,'huge-document.json'); const handle = await fs.open(hugeDoc,'w'); await handle.truncate(67108865); await handle.close();
  const result = await cli(['export',hugeDoc],{code:3}); assert.equal(result.error.code,'LIMIT_EXCEEDED'); assert.equal(result.error.details.limit,'documentBytes');
  const candidate = await snapshot(doc); candidate.graph.nodes.a.notes = '';
  const overhead = Buffer.byteLength(JSON.stringify(candidate)) + 1;
  candidate.graph.nodes.a.notes = 'x'.repeat(67108864-overhead-16);
  await fs.writeFile(doc,JSON.stringify(candidate)+'\n');
  const append = await request(dir,[{type:'updateNode',nodeId:'x',patch:{title:'A small edit'}}]);
  await unchanged(doc,async () => {
    const result = await cli(['apply',doc,'--input',append],{code:3}); assert.equal(result.error.code,'LIMIT_EXCEEDED'); assert.equal(result.error.details.limit,'documentBytes');
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join,relative } from 'node:path';
import { createHash } from 'node:crypto';
import { cli,workspace,snapshot,request,unchanged,worker,checkResult,nodes } from './helpers/cli.js';

const titleEdit = (nodeId,title) => [{type:'updateNode',nodeId,patch:{title}}];
function validateWorker(output,code) {
  assert.equal(output.code,code,output.stdout+output.stderr);
  assert.equal(output.stderr,''); assert.ok(checkResult(output.result),JSON.stringify(checkResult.errors)); return output.result;
}

test('P01: repeated readers on a graph with no coordination directory create no state',async t => {
  const {dir,doc} = await workspace(t);
  await fs.rm(join(dir,'.mindmap'),{recursive:true});
  const beforeFiles = await fs.readdir(dir);
  await unchanged(doc,async () => {
    for (let i=0;i<3;i++) {
      const [a,b,c] = await Promise.all([cli(['node',doc,'--id','x']),cli(['context',doc,'--nodes','a','--depth','2','--kinds','next']),cli(['neighbors',doc,'--id','c','--direction','incoming','--kinds','next'])]);
      assert.deepEqual([a.graphVersion,b.graphVersion,c.graphVersion],[1,1,1]); assert.deepEqual(nodes(b.data),['a','b','c']); assert.deepEqual(nodes(c.data),['b','c']);
    }
  });
  assert.deepEqual(await fs.readdir(dir),beforeFiles);
});

test('P02/P03/P05: held writer, nonblocking readers/preview, timeout, then kernel release on death',async t => {
  const {dir,doc} = await workspace(t);
  const a = await request(dir,titleEdit('a','A winner'));
  const b = await request(dir,titleEdit('b','B winner'));
  const held = worker(['apply',doc,'--input',a],{phase:'afterLockedReload'}); t.after(() => held.kill()); await held.ready;
  for (let i=0;i<3;i++) {
    const [read,preview] = await Promise.all([cli(['export',doc]),cli(['preview',doc,'--input',b])]);
    assert.equal(read.graphVersion,1); assert.equal(preview.graphVersion,1); assert.equal(read.data.document.graph.nodes.a.title,'Research');
  }
  await unchanged(doc,async () => assert.equal((await cli(['apply',doc,'--input',b,'--lock-timeout-ms','40'],{code:5})).error.code,'LOCK_TIMEOUT'));
  const beforeLocks = await fs.readdir(join(dir,'.mindmap','locks'));
  held.kill(); assert.equal((await held.completion).signal,'SIGKILL');
  await cli(['apply',doc,'--input',b,'--lock-timeout-ms','500']);
  const final = await snapshot(doc); assert.equal(final.metadata.graphVersion,2); assert.equal(final.graph.nodes.a.title,'Research'); assert.equal(final.graph.nodes.b.title,'B winner');
  assert.deepEqual(await fs.readdir(join(dir,'.mindmap','locks')),beforeLocks);
});

test('P02: deterministic locked reload race and repeated ordinary release executable races',async t => {
  const {dir,doc} = await workspace(t);
  const a = await request(dir,titleEdit('a','A committed'));
  const b = await request(dir,titleEdit('b','B rejected'));
  const held = worker(['apply',doc,'--input',a],{phase:'afterLockedReload'}); t.after(() => held.kill()); await held.ready;
  const loser = cli(['apply',doc,'--input',b],{code:4});
  held.release(); validateWorker(await held.completion,0);
  const result = await loser; assert.equal(result.error.code,'CONFLICT'); assert.equal(result.error.details.committed,false);
  assert.equal(result.error.details.expectedVersion,1); assert.equal(result.error.details.currentVersion,2);
  let final = await snapshot(doc); assert.equal(final.graph.nodes.a.title,'A committed'); assert.equal(final.graph.nodes.b.title,'Implement');
  for (let base=2;base<8;base++) {
    const files = await Promise.all(['a','b'].map(id => request(dir,titleEdit(id,`${id}-${base}`),{baseGraphVersion:base})));
    const results = await Promise.all(files.map(file => cli(['apply',doc,'--input',file],{code:[0,4]})));
    assert.equal(results.filter(r => r.ok).length,1); assert.equal(results.filter(r => r.error?.code === 'CONFLICT').length,1);
    final = await snapshot(doc); assert.equal(final.metadata.graphVersion,base+1); assert.equal(final.commits.length,base+1);
    const winner = results.findIndex(r => r.ok); const loser = 1-winner;
    assert.equal(final.graph.nodes[['a','b'][winner]].title,`${['a','b'][winner]}-${base}`);
    assert.notEqual(final.graph.nodes[['a','b'][loser]].title,`${['a','b'][loser]}-${base}`);
    assert.equal(final.commits.at(-1).operationId,results[winner].data.receipt.operationId);
  }
});

test('P04: simultaneous exact replay, later commits, removed targets and changed bytes',async t => {
  const {dir,doc} = await workspace(t);
  const file = await request(dir,titleEdit('x','Original exact request'));
  const bytes = await fs.readFile(file);
  const [a,b] = await Promise.all([cli(['apply',doc,'--input',file]),cli(['apply',doc,'--input',file])]);
  assert.deepEqual([a.data.replayed,b.data.replayed].sort(),[false,true]); assert.deepEqual(a.data.receipt,b.data.receipt);
  assert.equal(a.data.receipt.requestHash,createHash('sha256').update(bytes).digest('hex'));
  assert.equal((await snapshot(doc)).metadata.graphVersion,2);
  const removal = await request(dir,[{type:'removeNode',nodeId:'x',edgePolicy:'removeIncidentEdges'}],{baseGraphVersion:2});
  await cli(['apply',doc,'--input',removal]);
  const replay = await unchanged(doc,() => cli(['apply',doc,'--input',file])); assert.equal(replay.graphVersion,3); assert.equal(replay.data.receipt.committedGraphVersion,2);
  const receipt = await cli(['inspect',doc,'--operation-id',a.data.receipt.operationId]); assert.equal(receipt.graphVersion,3); assert.deepEqual(receipt.data.receipt,a.data.receipt);
  await fs.appendFile(file,'\n');
  await unchanged(doc,async () => assert.equal((await cli(['apply',doc,'--input',file],{code:3})).error.code,'OPERATION_ID_REUSE'));
  // Preview is not receipt replay and still checks its base version.
  await fs.writeFile(file,bytes); assert.equal((await cli(['preview',doc,'--input',file],{code:4})).error.code,'CONFLICT');
});

test('P06: physical path, symlink, case aliases and hard-link rejection',async t => {
  const {dir,doc} = await workspace(t);
  const alias = join(dir,'alias.json'); await fs.symlink(doc,alias);
  const first = await request(dir,titleEdit('a','via physical'));
  const second = await request(dir,titleEdit('b','via alias'));
  const held = worker(['apply',relative(process.cwd(),doc),'--input',first],{phase:'afterLockedReload'}); t.after(() => held.kill()); await held.ready;
  assert.equal((await cli(['apply',alias,'--input',second,'--lock-timeout-ms','0'],{code:5})).error.code,'LOCK_TIMEOUT');
  assert.equal((await cli(['apply',join(dir,'PLAN.JSON'),'--input',second,'--lock-timeout-ms','0'],{code:5})).error.code,'LOCK_TIMEOUT');
  held.release(); validateWorker(await held.completion,0);
  assert.equal((await cli(['inspect',alias])).graphVersion,2);
  const hard = join(dir,'hard.json'); await fs.link(doc,hard);
  const hardRequest = await request(dir,titleEdit('b','unsafe'),{baseGraphVersion:2});
  await unchanged(doc,async () => {
    const result = await cli(['apply',hard,'--input',hardRequest],{code:5}); assert.equal(result.error.code,'UNSUPPORTED_STORAGE'); assert.equal(result.error.details.reason,'hard_link');
  });
});

test('P07: crash at each publication stage, exact recovery and intervening-commit conflict',async t => {
  for (const phase of ['beforeTemporarySync','afterTemporarySync','afterReplace','afterDurability']) {
    await t.test(phase,async t => {
      const {dir,doc} = await workspace(t);
      const file = await request(dir,titleEdit('a','Recovered'));
      const held = worker(['apply',doc,'--input',file],{phase}); t.after(() => held.kill()); await held.ready;
      const published = ['afterReplace','afterDurability'].includes(phase);
      const reader = await cli(['export',doc]); assert.equal(reader.graphVersion,published ? 2 : 1);
      assert.equal(reader.data.document.graph.nodes.a.title,published ? 'Recovered' : 'Research');
      const preview = await cli(['preview',doc,'--input',file],{code:published ? 4 : 0}); assert.equal(preview.graphVersion,published ? 2 : 1);
      held.kill(); await held.completion;
      const recovered = await cli(['apply',doc,'--input',file]); assert.equal(recovered.graphVersion,2); assert.equal(recovered.data.replayed,published);
      const final = await snapshot(doc); assert.equal(final.commits.length,2); assert.equal(final.graph.nodes.a.title,'Recovered');
    });
  }
  const {dir,doc} = await workspace(t);
  const a = await request(dir,titleEdit('a','Never committed'));
  const b = await request(dir,titleEdit('b','Intervening commit'));
  const held = worker(['apply',doc,'--input',a],{phase:'afterTemporarySync'}); t.after(() => held.kill()); await held.ready; held.kill(); await held.completion;
  await cli(['apply',doc,'--input',b]);
  const retry = await unchanged(doc,() => cli(['apply',doc,'--input',a],{code:4})); assert.equal(retry.error.details.committed,false);
  assert.equal((await snapshot(doc)).graph.nodes.a.title,'Research');
});

test('P08: disk-full, permission, replace/sync failures and replay durability uncertainty',async t => {
  for (const [phase,errorCode,published] of [['beforeTemporarySync','ENOSPC',false],['afterTemporarySync','EACCES',false],['beforeReplace','EIO',false],['afterReplace','EIO',true],['afterDurability','EIO',true]]) {
    await t.test(phase,async t => {
      const {dir,doc} = await workspace(t);
      const file = await request(dir,titleEdit('a','After failure'));
      const before = await fs.readFile(doc);
      const injected = worker(['apply',doc,'--input',file],{phase,mode:'error',errorCode});
      const result = validateWorker(await injected.completion,5);
      assert.equal(result.error.code,published ? 'COMMIT_OUTCOME_UNKNOWN' : 'IO_ERROR');
      if (!published) assert.deepEqual(await fs.readFile(doc),before);
      else assert.equal(result.error.details.outcome,'unknown');
      const retry = await cli(['apply',doc,'--input',file,'--lock-timeout-ms','500']); assert.equal(retry.data.replayed,published); assert.equal(retry.graphVersion,2);
      const files = await fs.readdir(dir); assert.equal(files.filter(f => f.endsWith('.tmp')).length,0);
    });
  }
  const {dir,doc} = await workspace(t);
  const file = await request(dir,titleEdit('a','Committed'));
  await cli(['apply',doc,'--input',file]);
  const retryFailure = worker(['apply',doc,'--input',file],{phase:'beforeReplaySync',mode:'error',errorCode:'EIO'});
  const failed = validateWorker(await retryFailure.completion,5); assert.equal(failed.error.code,'COMMIT_OUTCOME_UNKNOWN'); assert.equal(failed.error.details.phase,'replaySync');
  assert.equal((await cli(['apply',doc,'--input',file])).data.replayed,true);
});

test('P10: concurrent create, case aliases, invalid existing targets and interrupted creation',async t => {
  const dir = await fs.mkdtemp('/private/tmp/mindmap create '); t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const doc = join(dir,'Create.json');
  const results = await Promise.all([cli(['create',doc,'--id','plan'],{code:[0,3]}),cli(['create',join(dir,'create.JSON'),'--id','other'],{code:[0,3]})]);
  assert.equal(results.filter(r => r.ok).length,1); assert.equal(results.find(r => !r.ok).error.code,'ALREADY_EXISTS'); assert.equal((await snapshot(doc)).metadata.graphVersion,0);
  for (const phase of ['beforeTemporarySync','afterTemporarySync','afterReplace','afterDurability']) {
    const path = join(dir,phase+'.json'); const held = worker(['create',path,'--id','plan'],{phase}); t.after(() => held.kill()); await held.ready; held.kill(); await held.completion;
    const published = ['afterReplace','afterDurability'].includes(phase);
    const retry = await cli(['create',path,'--id','plan'],{code:published ? 3 : 0});
    if (published) assert.equal(retry.error.code,'ALREADY_EXISTS');
    assert.equal((await snapshot(path)).metadata.graphVersion,0);
  }
});

test('P08: unexpected defects disclose whether publication already happened',async t => {
  for (const phase of ['beforeReplace','afterReplace']) {
    const {dir,doc} = await workspace(t);
    const file = await request(dir,titleEdit('a','Candidate'));
    const failure = worker(['apply',doc,'--input',file],{phase,mode:'internal'});
    const result = validateWorker(await failure.completion,6);
    assert.equal(result.error.code,'INTERNAL_ERROR');
    assert.equal(result.error.details.outcome,phase === 'afterReplace' ? 'unknown' : 'not_published');
    const retry = await cli(['apply',doc,'--input',file]); assert.equal(retry.graphVersion,2);
  }
});

test('P06/P10: APFS Unicode normalization and case aliases share a creation lock',async t => {
  const dir = await fs.mkdtemp('/private/tmp/mindmap unicode '); t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const a = join(dir,'CAFÉ.json'), b = join(dir,'cafe\u0301.JSON');
  const held = worker(['create',a,'--id','plan'],{phase:'afterLockedReload'}); t.after(() => held.kill()); await held.ready;
  const result = await cli(['create',b,'--id','other','--lock-timeout-ms','0'],{code:5}); assert.equal(result.error.code,'LOCK_TIMEOUT');
  held.release(); validateWorker(await held.completion,0);
  assert.equal((await cli(['inspect',b])).documentId,'plan');
  assert.equal((await fs.readdir(dir)).filter(name => name.toLowerCase().endsWith('.json')).length,1);
});

test('P08: failures from actual write, file sync, rename and directory sync primitives',async t => {
  for (const [fault,errorCode,published] of [['partialWrite','ENOSPC',false],['fileSync','EIO',false],['replace','EACCES',false],['directorySync','EIO',true]]) {
    const {dir,doc} = await workspace(t);
    const file = await request(dir,titleEdit('a','Primitive recovery'));
    const before = await fs.readFile(doc);
    const failed = worker(['apply',doc,'--input',file],{fault,errorCode});
    const result = validateWorker(await failed.completion,5);
    assert.equal(result.error.code,published ? 'COMMIT_OUTCOME_UNKNOWN' : 'IO_ERROR');
    if (!published) assert.deepEqual(await fs.readFile(doc),before);
    const retry = await cli(['apply',doc,'--input',file]); assert.equal(retry.data.replayed,published); assert.equal(retry.graphVersion,2);
    assert.equal((await snapshot(doc)).graph.nodes.a.title,'Primitive recovery');
    assert.equal((await fs.readdir(dir)).some(f => f.endsWith('.tmp')),false);
  }
});

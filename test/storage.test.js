import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli,workspace,request,unchanged,packageRoot } from './helpers/cli.js';
const {persistence} = await import(pathToFileURL(join(packageRoot,'dist/persistence.js')));
const {MindmapError} = await import(pathToFileURL(join(packageRoot,'dist/errors.js')));

test('C13: doctor no-write/probe modes, permission failures and regular-file checks',async t => {
  const {dir,doc} = await workspace(t);
  const before = await fs.readdir(dir,{recursive:true});
  const ordinary = await cli(['doctor'],{cwd:dir}); assert.equal(ordinary.data.supported,true);
  assert.deepEqual(await fs.readdir(dir,{recursive:true}),before);
  const probed = await cli(['doctor','--directory',dir]); assert.equal(probed.data.supported,true); assert.equal(probed.data.checks.some(c => c.name === 'kernelLock' && c.ok),true);
  assert.deepEqual(await fs.readdir(dir,{recursive:true}),before);
  const file = await request(dir,[{type:'updateNode',nodeId:'a',patch:{title:'Denied'}}]);
  await fs.chmod(doc,0o400); t.after(() => fs.chmod(doc,0o600).catch(() => {}));
  await cli(['inspect',doc]);
  await unchanged(doc,async () => assert.equal((await cli(['apply',doc,'--input',file],{code:5})).error.code,'IO_ERROR'));
  await fs.chmod(doc,0o640); await cli(['apply',doc,'--input',file]); assert.equal((await fs.stat(doc)).mode & 0o777,0o640);
  const deniedDir = join(dir,'readonly'); await fs.mkdir(deniedDir,0o500); t.after(() => fs.chmod(deniedDir,0o700).catch(() => {}));
  assert.equal((await cli(['create',join(deniedDir,'new.json')],{code:5})).error.code,'IO_ERROR');
  await fs.chmod(deniedDir,0o700);
  assert.equal((await cli(['inspect',join(dir,'missing.json')],{code:3})).error.code,'DOCUMENT_NOT_FOUND');
  assert.equal((await cli(['create',join(dir,'missing-parent','new.json')],{code:5})).error.code,'IO_ERROR');
});

test('C13/P06: adapter precedence, network storage rejection and unsafe coordination paths',async t => {
  const {dir,doc} = await workspace(t);
  let loaded = false;
  const unsupported = persistence({platform:'win32',adapter:async () => {loaded=true;throw new Error('must not load');}});
  await assert.rejects(unsupported.create(join(dir,'windows.json'),{}),e => e.code === 'UNSUPPORTED_STORAGE' && e.details.reason === 'platform'); assert.equal(loaded,false);
  const unavailable = persistence({adapter:async path => {throw new MindmapError('LOCK_UNAVAILABLE','Missing test adapter',{path,platform:process.platform,reason:'missing'});}});
  await assert.rejects(unavailable.create(join(dir,'unavailable.json'),{}),e => e.code === 'LOCK_UNAVAILABLE');
  assert.equal((await unavailable.read(doc)).document.metadata.graphVersion,1);
  const network = persistence({fileSystem:{...fs,statfs:async () => ({type:0x6969})},adapter:async () => {loaded=true;throw new Error('must not load');}});
  await assert.rejects(network.create(join(dir,'network.json'),{}),e => e.code === 'UNSUPPORTED_STORAGE' && e.details.reason === 'filesystem'); assert.equal(loaded,false);
  const other = join(dir,'unsafe'); await fs.mkdir(other); await fs.symlink(join(dir,'.mindmap'),join(other,'.mindmap'));
  assert.equal((await cli(['create',join(other,'new.json')],{code:5})).error.details.reason,'path_identity');
  const dangling = join(dir,'dangling.json'); await fs.symlink(join(dir,'absent.json'),dangling);
  assert.equal((await cli(['create',dangling],{code:3})).error.code,'ALREADY_EXISTS');
});

test('P05: native descriptors retain FD_CLOEXEC with the real Darwin variadic ABI',async () => {
  const {default:koffi} = await import('koffi');
  const {nativeAdapter} = await import(pathToFileURL(join(packageRoot,'dist/native.js')));
  const library = koffi.load('/usr/lib/libSystem.B.dylib');
  const fcntl = library.func('int fcntl(int fd, int command, ...)');
  const handle = await fs.open('/private/tmp','r');
  try {
    assert.equal(fcntl(handle.fd,2,'int',0),0);
    assert.equal(fcntl(handle.fd,1) & 1,0);
    (await nativeAdapter('/private/tmp')).nonInheritable(handle.fd);
    assert.equal(fcntl(handle.fd,1) & 1,1);
  } finally { await handle.close(); }
});

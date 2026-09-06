import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import os from 'node:os';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('..',import.meta.url));
const evidence = resolve(process.argv[2] || join(root,'test-results/package'));
await fs.mkdir(evidence,{recursive:true});
await fs.rm(join(evidence,'summary.json'),{force:true});
const temp = await fs.mkdtemp('/private/tmp/mindmap package ');
const install = join(temp,'clean install'); await fs.mkdir(install);
async function run(executable,args,options = {}) {
  const {stdout,stderr} = await exec(executable,args,{cwd:root,maxBuffer:40*1024*1024,timeout:240000,...options});
  if (stderr) process.stderr.write(stderr); return stdout;
}
async function permissions(path,writable) {
  const stat = await fs.lstat(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    if (writable) await fs.chmod(path,0o755);
    for (const name of await fs.readdir(path)) await permissions(join(path,name),writable);
    if (!writable) await fs.chmod(path,0o555);
  } else await fs.chmod(path,writable ? ((stat.mode & 0o111) ? 0o755 : 0o644) : ((stat.mode & 0o111) ? 0o555 : 0o444));
}
async function assetHash(path) {
  const hash = createHash('sha256');
  async function visit(path,relative='') {
    const stat = await fs.lstat(path); hash.update(relative);
    if (stat.isSymbolicLink()) hash.update(await fs.readlink(path));
    else if (stat.isDirectory()) for (const name of (await fs.readdir(path)).sort()) await visit(join(path,name),relative+'/'+name);
    else hash.update(await fs.readFile(path));
  }
  await visit(path); return hash.digest('hex');
}
try {
  await run(process.execPath,['scripts/build.js']);
  const packed = JSON.parse(await run('npm',['--cache','/private/tmp/mindmap-npm-cache','pack','--ignore-scripts','--json','--pack-destination',evidence]));
  const artifact = join(evidence,packed[0].filename);
  const hash = createHash('sha256').update(await fs.readFile(artifact)).digest('hex');
  for (const file of packed[0].files) assert.ok(!/(^|\/)(src|test|webui|\.codex-plugin)(\/|$)/.test(file.path),file.path);
  await fs.writeFile(join(install,'package.json'),'{"private":true}\n');
  const installOutput = await run('npm',['--cache','/private/tmp/mindmap-npm-cache','install','--prefix',install,'--ignore-scripts','--omit=dev','--no-audit','--no-fund',artifact]);
  await fs.writeFile(join(evidence,'install.log'),installOutput);
  const modules = join(install,'node_modules'),bin = join(modules,'mindmap-cli','bin','mindmap.js');
  assert.equal(JSON.parse(await fs.readFile(join(modules,'mindmap-cli','package.json'),'utf8')).version,'0.2.0');
  await permissions(modules,false);
  const beforeHash = await assetHash(modules);
  const binOutput = await run(join(modules,'.bin','mindmap'),['--version','--json'],{cwd:install});
  assert.equal(JSON.parse(binOutput).data.version,'0.2.0');
  await fs.writeFile(join(evidence,'bin-resolution.json'),binOutput);
  const npmExec = await run('npm',['--cache','/private/tmp/mindmap-npm-cache','exec','--offline','--prefix',install,'--','mindmap','--version','--json'],{cwd:install});
  assert.equal(JSON.parse(npmExec).data.version,'0.2.0');
  const tests = (await fs.readdir(join(root,'test'))).filter(f => f.endsWith('.test.js')).sort().map(f => join(root,'test',f));
  const transcript = join(evidence,'commands.ndjson'); await fs.writeFile(transcript,'');
  const output = await run(process.execPath,['--test','--test-concurrency=1',...tests],{env:{...process.env,MINDMAP_TEST_BIN:bin,MINDMAP_TEST_LOG:transcript}});
  await fs.writeFile(join(evidence,'tests.tap'),output); process.stdout.write(output);
  const work = join(temp,'independent caller'); await fs.mkdir(work);
  const evaluator = join(temp,'evaluate.js'); await fs.copyFile(join(root,'test/helpers/evaluate-package.js'),evaluator);
  // The separate caller has no source checkout or fixture imports, and its CLI
  // children are denied both networking and process creation by the OS sandbox.
  const profile = join(temp,'offline.sb'); await fs.writeFile(profile,'(version 1)\n(allow default)\n(deny network*)\n(deny process-fork)\n');
  const evaluation = await run(process.execPath,[evaluator,bin,work,join(evidence,'independent-evaluation.json'),profile],{cwd:work});
  process.stdout.write(evaluation);
  assert.equal(await assetHash(modules),beforeHash,'Immutable package/dependencies changed during runtime');
  // A separate damaged installation proves that read commands have no native
  // adapter dependency and that missing adapter assets produce a stable error.
  const faultInstall = join(temp,'missing adapter');
  await fs.cp(install,faultInstall,{recursive:true,verbatimSymlinks:true});
  await permissions(faultInstall,true);
  const native = join(faultInstall,'node_modules',`@koromix/koffi-${process.platform}-${process.arch}`,`${process.platform}_${process.arch}`,'koffi.node');
  await fs.rename(native,native+'.absent');
  const faultBin = join(faultInstall,'node_modules/mindmap-cli/bin/mindmap.js');
  const readWithoutAdapter = JSON.parse(await run(process.execPath,[faultBin,'inspect',join(work,'evaluation.json'),'--json']));
  assert.equal(readWithoutAdapter.ok,true);
  for (const args of [['doctor'],['create',join(work,'unavailable.json')]]) {
    try { await run(process.execPath,[faultBin,...args,'--json']); assert.fail('Missing adapter was accepted'); }
    catch (error) {
      assert.equal(error.code,5,error.stderr);
      assert.equal(JSON.parse(error.stdout).error.code,'LOCK_UNAVAILABLE');
    }
  }
  assert.equal(await fs.stat(join(work,'unavailable.json')).then(() => true,() => false),false);
  const summary = {version:'0.2.0',artifact:packed[0].filename,sha256:hash,nodeVersion:process.versions.node,os:process.platform,osRelease:os.release(),arch:process.arch,filesystemType:(await fs.statfs(temp)).type,installScripts:false,developmentDependencies:false,immutableAssets:true,layoutProfiles:['flowchart','mindmap','dependency','network','fishbone'],svgAndMermaidHints:true,bundledFont:true,missingAdapterVerified:true,offlineCommands:true,childProcessesDenied:true,independentEvaluator:'separate schema-driven program; no source or internal fixtures',powerLossTested:false,completedAt:new Date().toISOString()};
  await fs.writeFile(join(evidence,'summary.json'),JSON.stringify(summary,null,2)+'\n');
  console.log('Package acceptance evidence: '+evidence);
} finally {
  await permissions(temp,true).catch(() => {});
  await fs.rm(temp,{recursive:true,force:true});
}

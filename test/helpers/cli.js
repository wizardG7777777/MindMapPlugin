import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
const exec = promisify(execFile);
export const bin = process.env.MINDMAP_TEST_BIN || fileURLToPath(new URL('../../bin/mindmap.js',import.meta.url));
export const packageRoot = dirname(dirname(bin));
export const ajv = new Ajv2020({strict:false,ownProperties:true});
export const resultSchema = JSON.parse(readFileSync(join(packageRoot,'schemas/result.json'),'utf8'));
export const documentSchema = JSON.parse(readFileSync(join(packageRoot,'schemas/document.json'),'utf8'));
export const checkResult = ajv.compile(resultSchema);
export const checkDocument = ajv.compile(documentSchema);
export async function cli(args,{input,code = 0,cwd,env = {}} = {}) {
  let stdout,stderr,actual = 0;
  try { ({stdout,stderr} = await exec(process.execPath,[bin,...args,'--json'],{cwd,env:{...process.env,...env},maxBuffer:200 * 1024 * 1024,timeout:30000,input})); }
  catch (error) { actual = error.code; stdout = error.stdout; stderr = error.stderr; }
  // execFile does not feed stdin; stdin tests use raw() below.
  assert.equal(stderr,'',`Unexpected stderr for ${args.join(' ')}: ${stderr}`);
  assert.equal(stdout.trim().split('\n').length,1,'Exactly one stdout JSON object');
  const result = JSON.parse(stdout);
  assert.ok(checkResult(result),JSON.stringify(checkResult.errors) + '\n' + stdout.slice(0,2000));
  if (Array.isArray(code)) assert.ok(code.includes(actual),`${args.join(' ')}: ${stdout.slice(0,2000)}`);
  else assert.equal(actual,code,`${args.join(' ')}: ${stdout.slice(0,2000)}`);
  assert.equal(result.ok,actual === 0);
  if (process.env.MINDMAP_TEST_LOG) await fs.appendFile(process.env.MINDMAP_TEST_LOG,JSON.stringify({args,exitCode:actual,result:stdout.length < 10000 ? result : {command:result.command,ok:result.ok,graphVersion:result.graphVersion,bytes:Buffer.byteLength(stdout)}}) + '\n');
  return result;
}
export async function workspace(t,{build = true} = {}) {
  const dir = await fs.mkdtemp('/private/tmp/mindmap test ');
  t.after(() => fs.rm(dir,{recursive:true,force:true}));
  const doc = join(dir,'plan.json');
  await cli(['create',doc,'--id','plan','--title','Shared plan']);
  const batch = join(dir,'build.json');
  await fs.copyFile(join(packageRoot,'samples/operations/build-general-graph.json'),batch);
  if (build) await cli(['apply',doc,'--input',batch]);
  return {dir,doc,batch};
}
export const nodes = data => data.nodes.map(n => n.id);
export const edges = data => data.edges.map(e => e.id);
export async function snapshot(path) {
  const doc = JSON.parse(await fs.readFile(path,'utf8'));
  assert.ok(checkDocument(doc),JSON.stringify(checkDocument.errors));
  return doc;
}
export async function request(dir,operations,{baseGraphVersion = 1,operationId = randomUUID(),scope = {mode:'document',allowDelete:true},...extra} = {}) {
  const file = join(dir,operationId + '.json');
  await fs.writeFile(file,JSON.stringify({envelopeVersion:1,documentId:'plan',baseGraphVersion,operationId,scope,...extra,operations}) + '\n');
  return file;
}
export async function unchanged(doc,action) {
  const before = await fs.readFile(doc); const result = await action();
  assert.deepEqual(await fs.readFile(doc),before); return result;
}
export function worker(args,{phase,mode = 'pause',errorCode = 'EIO',fault = ''} = {}) {
  const child = fork(fileURLToPath(new URL('./worker.js',import.meta.url)),args,{env:{...process.env,MINDMAP_TEST_BIN:bin,TEST_PHASE:phase ?? '',TEST_MODE:mode,TEST_ERROR_CODE:errorCode,TEST_IO_FAULT:fault},stdio:['pipe','pipe','pipe','ipc']});
  let stdout = '',stderr = '';
  child.stdout.on('data',s => stdout += s); child.stderr.on('data',s => stderr += s);
  const completion = new Promise((resolve,reject) => { child.on('error',reject); child.on('close',(code,signal) => resolve({code,signal,stdout,stderr,result:stdout ? JSON.parse(stdout) : null})); });
  const ready = new Promise((resolve,reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Worker never reached ' + phase + ': ' + stderr + stdout)); },15000);
    child.once('message',message => {clearTimeout(timer);resolve(message);});
    child.once('exit',() => {clearTimeout(timer);reject(new Error('Worker exited before barrier: ' + stderr + stdout));});
  });
  // Every caller must await ready. Attach a rejection handler immediately to
  // avoid an unhandled rejection if another assertion fails first.
  ready.catch(() => {});
  return {child,completion,ready,release:() => child.send('release'),kill:() => child.kill('SIGKILL')};
}

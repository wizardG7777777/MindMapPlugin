import fs from 'node:fs/promises';
import { basename,dirname,join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = dirname(dirname(process.env.MINDMAP_TEST_BIN));
const { runCLI } = await import(pathToFileURL(join(root,'dist/cli.js')));
const { persistence } = await import(pathToFileURL(join(root,'dist/persistence.js')));
let reached = false;
const hook = async phase => {
  if (phase !== process.env.TEST_PHASE || reached) return;
  reached = true;
  if (process.env.TEST_MODE === 'internal') throw new Error('Injected unexpected defect');
  if (process.env.TEST_MODE === 'error') throw Object.assign(new Error('Injected ' + process.env.TEST_ERROR_CODE),{code:process.env.TEST_ERROR_CODE});
  await new Promise(resolve => { process.once('message',resolve); process.send({phase}); });
};
const fault = process.env.TEST_IO_FAULT;
const failure = () => Object.assign(new Error('Injected primitive failure'),{code:process.env.TEST_ERROR_CODE});
const fileSystem = fault ? {
  ...fs,
  async rename(...args) { if (fault === 'replace') throw failure(); return fs.rename(...args); },
  async open(...args) {
    const handle = await fs.open(...args);
    const temporary = basename(String(args[0])).startsWith('.mindmap-') && String(args[0]).endsWith('.tmp');
    const directory = (await handle.stat()).isDirectory();
    return new Proxy(handle,{get(target,key) {
      if (key === 'writeFile' && temporary && fault === 'partialWrite') return async bytes => { await target.writeFile(bytes.subarray(0,64)); throw failure(); };
      if (key === 'sync' && ((temporary && fault === 'fileSync') || (directory && fault === 'directorySync'))) return async () => { throw failure(); };
      const value=Reflect.get(target,key,target); return typeof value === 'function' ? value.bind(target) : value;
    }});
  },
} : undefined;
process.exitCode = await runCLI([...process.argv.slice(2),'--json'],{store:persistence({hook,...(fileSystem ? {fileSystem} : {})})});
if (process.connected) process.disconnect();

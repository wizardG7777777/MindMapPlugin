import test from 'node:test';
import assert from 'node:assert/strict';
import { FileReadError, readSnapshot, type FileHandle } from '../src/file-session.ts';
import { resumeFile } from '../src/resume-file.ts';

function file(content = 'disk'): FileHandle {
  return { name: 'graph.html', getFile: async () => ({ text: async () => content, size: content.length, lastModified: 1 }),
    createWritable: async () => { throw new Error('not used'); }, queryPermission: async () => 'granted', requestPermission: async () => 'granted' };
}
test('automatic refresh reads the live capability even when its stored clone has lost permission', async () => {
  const live = file('agent content'); let restored = 0;
  const deniedClone = file();
  deniedClone.getFile = async () => { throw new DOMException('context refused', 'NotAllowedError'); };
  deniedClone.queryPermission = async () => 'prompt';
  const load = await resumeFile(live, async () => { restored++; return deniedClone; });
  assert.equal(restored, 0); assert.equal(load!.handle, live); assert.equal(load!.snapshot.source, 'agent content');
});
test('each refresh obtains fresh disk data rather than carrying the prior loaded source', async () => {
  const live = file(); let disk = 'first';
  live.getFile = async () => { const source = disk; return { text: async () => source, size: source.length, lastModified: 1 }; };
  assert.equal((await resumeFile(live, async () => null))!.snapshot.source, 'first');
  disk = 'second';
  assert.equal((await resumeFile(live, async () => null))!.snapshot.source, 'second');
});
test('manual navigation restores capabilities but surfaces permission loss without prompting or inventing a graph', async () => {
  const denied = file(); let prompts = 0;
  denied.getFile = async () => { throw new DOMException('context refused', 'NotAllowedError'); };
  denied.queryPermission = async () => 'prompt'; denied.requestPermission = async () => { prompts++; return 'granted'; };
  await assert.rejects(resumeFile(null, async () => denied), error => error instanceof FileReadError
    && error.originalName === 'NotAllowedError' && error.phase === 'get-file' && error.permission === 'prompt');
  assert.equal(prompts, 0);
});
test('a File invalidated between getFile and text is reacquired once', async () => {
  const live = file(); let reads = 0;
  live.getFile = async () => { const count = ++reads; return { size: 4, lastModified: count, text: async () => {
    if (count === 1) throw new DOMException('snapshot stale', 'NotReadableError'); return 'next';
  } }; };
  assert.equal((await readSnapshot(live)).source, 'next'); assert.equal(reads, 2);
});
test('a persistent read failure is bounded and keeps its diagnostic phase', async () => {
  const live = file(); let reads = 0;
  live.getFile = async () => { reads++; return { size: 1, lastModified: 1, text: async () => { throw new DOMException('unreadable', 'NotReadableError'); } }; };
  await assert.rejects(readSnapshot(live), error => error instanceof FileReadError && error.phase === 'read-content');
  assert.equal(reads, 2);
});

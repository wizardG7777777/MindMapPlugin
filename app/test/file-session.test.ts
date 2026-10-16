import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileSession, readSnapshot, type FileHandle, type Writer } from '../src/file-session.ts';

class MemoryFile implements FileHandle {
  name = 'graph.html'; content = 'disk'; modified = 1;
  failClose = false; failRead = false; writes = 0; aborts = 0;
  queryPermission = async () => 'granted' as const;
  requestPermission = async () => 'granted' as const;
  async getFile() {
    if (this.failRead) throw new Error('file unavailable');
    const content = this.content;
    return { text: async () => content, size: content.length, lastModified: this.modified };
  }
  async createWritable(): Promise<Writer> {
    let pending = this.content;
    return { write: async text => { this.writes++; pending = text; },
      close: async () => { if (this.failClose) throw new Error('close failed'); this.content = pending; this.modified++; },
      abort: async () => { this.aborts++; } };
  }
}
async function setup(handle = new MemoryFile()) {
  const refreshes: string[] = [], errors: unknown[] = [];
  const session = new FileSession(handle, await readSnapshot(handle), reason => refreshes.push(reason), error => errors.push(error));
  return { handle, session, refreshes, errors };
}
test('save waits for close then forces reload; repeated save cannot write stale state', async () => {
  const f = await setup();
  assert.equal(await f.session.save('user edit', Promise.resolve('granted')), true);
  assert.equal(f.handle.content, 'user edit'); assert.deepEqual(f.refreshes, ['saved']);
  assert.equal(await f.session.save('old state', Promise.resolve('granted')), false);
  assert.equal(f.handle.writes, 1);
});
test('agent disk edit wins over a stale save; unsaved source is never written', async () => {
  const f = await setup(); f.handle.content = 'agent edit';
  assert.equal(await f.session.save('unsaved draft', Promise.resolve('granted')), false);
  assert.equal(f.handle.writes, 0); assert.deepEqual(f.refreshes, ['disk-change-before-save']);
});
test('observer or metadata-only changes force refresh; ordinary polling is quiet', async () => {
  const f = await setup(); await f.session.check(); assert.deepEqual(f.refreshes, []);
  f.handle.modified++; await f.session.check(); assert.deepEqual(f.refreshes, ['disk-change']);
  const g = await setup(); await g.session.check(true); assert.deepEqual(g.refreshes, ['disk-change']);
});
test('permission denied and write failure preserve memory session, never report saved', async () => {
  const f = await setup(); await f.session.save('draft', Promise.resolve('denied'));
  assert.equal(f.handle.writes, 0); assert.equal(f.session.invalidated, false); assert.deepEqual(f.refreshes, []);
  f.handle.failClose = true; await f.session.save('draft', Promise.resolve('granted'));
  assert.equal(f.handle.content, 'disk'); assert.deepEqual(f.refreshes, []); assert.equal(f.errors.length, 2); assert.equal(f.handle.aborts, 1);
});
test('file deletion invalidates the session instead of constructing an empty graph', async () => {
  const f = await setup(); f.handle.failRead = true; await f.session.check();
  assert.equal(f.session.invalidated, true); assert.equal(f.errors.length, 1);
  assert.equal(await f.session.save('recreate', Promise.resolve('granted')), false);
});
test('an old file session cannot resume a deferred save after switching documents', async () => {
  const f = await setup(); let resolve!: (value: PermissionState) => void;
  const pending = f.session.save('old', new Promise<PermissionState>(r => resolve = r));
  f.session.stop(); resolve('granted'); assert.equal(await pending, false); assert.equal(f.handle.writes, 0);
});
test('real filesystem adapter: external change is observed and a completed save changes disk', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'mindmap-session-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'graph.html'); await writeFile(path, 'initial');
  const handle: FileHandle = {
    name: 'graph.html', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
    getFile: async () => { const fileStat = await stat(path), source = await readFile(path, 'utf8'); return { text: async () => source, size: fileStat.size, lastModified: fileStat.mtimeMs }; },
    createWritable: async () => { let pending = ''; return { write: async source => { pending = source; }, close: async () => { await writeFile(path, pending); }, abort: async () => {} }; },
  };
  const events: string[] = [];
  const first = new FileSession(handle, await readSnapshot(handle), r => events.push(r), e => { throw e; });
  await writeFile(path, 'agent'); await first.check(); assert.deepEqual(events, ['disk-change']);
  const second = new FileSession(handle, await readSnapshot(handle), r => events.push(r), e => { throw e; });
  await second.save('human', Promise.resolve('granted'));
  assert.equal(await readFile(path, 'utf8'), 'human'); assert.deepEqual(events, ['disk-change', 'saved']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityStore, type CapabilityRecords, type SelectionIndex } from '../src/capability-store.ts';

function setup() {
  const values = new Map<string, string>([['old', 'old.html']]);
  const records: CapabilityRecords<string> = {
    get: async key => values.get(key),
    put: async (key, value) => { values.set(key, value); },
    remove: async key => { values.delete(key); },
  };
  let selected = 'old', sequence = 0;
  const selection: SelectionIndex = { get: () => selected, set: key => { selected = key; } };
  const store = capabilityStore(records, selection, () => `new-${++sequence}`);
  return { store, records, values, selection };
}

test('refresh during file preparation still restores the previously committed file', async () => {
  const f = setup();
  let release!: () => void;
  const put = f.records.put;
  f.records.put = async (key, value) => { await new Promise<void>(resolve => { release = resolve; }); await put(key, value); };
  const preparing = f.store.prepare('candidate.html');
  assert.equal(await f.store.recall(), 'old.html');
  release(); const candidate = await preparing;
  assert.equal(await f.store.recall(), 'old.html');
  // An old-file refresh invalidates the open operation; no commit is permitted by caller.
  await candidate.discard();
  assert.equal(await f.store.recall(), 'old.html');
  assert.deepEqual([...f.values.keys()], ['old']);
});
test('a superseded slow picker cannot replace the later committed file', async () => {
  const f = setup();
  const first = await f.store.prepare('first.html');
  const second = await f.store.prepare('second.html');
  second.commit(); await first.discard();
  assert.equal(await f.store.recall(), 'second.html');
});
test('failed selection persistence leaves the original file recoverable', async () => {
  const f = setup(); const candidate = await f.store.prepare('candidate.html');
  f.selection.set = () => { throw new Error('storage unavailable'); };
  assert.throws(() => candidate.commit(), /storage unavailable/);
  await candidate.discard(); assert.equal(await f.store.recall(), 'old.html');
});
test('switching one tab does not delete the capability still referenced by a duplicate tab', async () => {
  const f = setup();
  const duplicate = capabilityStore(f.records, { get: () => 'old', set: () => {} }, () => 'duplicate');
  const candidate = await f.store.prepare('new.html'); candidate.commit(); await candidate.discard();
  assert.equal(await f.store.recall(), 'new.html'); assert.equal(await duplicate.recall(), 'old.html');
});

import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, basename, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { parseJSON, readBounded, DOCUMENT_BYTES } from './json.js';
import { validateDocument } from './validation.js';
import { createDocument, edit, checkIdentity } from './graph.js';
import { fail, limit, ioError, observed, MindmapError } from './errors.js';
import { adapterAssets, nativeAdapter } from './native.js';
import { writeSupport, filesystemNames } from './support.js';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Hooks are internal dependency injection. The release executable does not read
// failpoint environment variables, load arbitrary adapters, or expose test flags.
export function persistence({ hook = async () => {}, adapter = nativeAdapter, support = writeSupport, platform = process.platform, arch = process.arch, fileSystem = fs } = {}) {
  const fs = fileSystem;
  async function read(path) {
    const absolute = resolve(path);
    let handle;
    try {
      const physical = await fs.realpath(absolute);
      handle = await fs.open(physical,'r');
      const bytes = await readBounded(handle,DOCUMENT_BYTES,'documentBytes');
      return { path:physical, document:validateDocument(parseJSON(bytes,'document',physical)) };
    } catch (error) {
      if (error.code === 'ENOENT') fail('DOCUMENT_NOT_FOUND','Document file does not exist.',{path:absolute});
      throw ioError(error,absolute,'read');
    } finally { if (handle) await handle.close(); }
  }
  async function storage(path) {
    const row = support.find(row => row.os === platform && row.arch === arch && row.nodeVersions.includes(process.versions.node));
    if (!row) fail('UNSUPPORTED_STORAGE','Writes are not advertised for this platform/runtime.',{path,reason:'platform',platform,arch,nodeVersion:process.versions.node});
    const stat = await fs.statfs(path);
    const filesystem = filesystemNames.get(stat.type);
    if (!filesystem || !row.filesystems.includes(filesystem)) fail('UNSUPPORTED_STORAGE','Untested or unsupported filesystem.',{path,reason:'filesystem',filesystemType:stat.type});
    return { filesystem };
  }
  async function identity(path,creating) {
    const absolute = resolve(path);
    try {
      let physical, exists = false;
      try {
        const stat = await fs.lstat(absolute);
        if (creating && stat.isSymbolicLink()) {
          // Any existing name, even a dangling symlink, is not a create target.
          fail('ALREADY_EXISTS','Target already exists.',{path:absolute});
        }
        physical = await fs.realpath(absolute); exists = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (!creating) fail('DOCUMENT_NOT_FOUND','Document file does not exist.',{path:absolute});
        physical = join(await fs.realpath(dirname(absolute)),basename(absolute));
      }
      const parent = dirname(physical);
      await storage(parent);
      const native = await adapter(physical);
      let directory;
      let key;
      try {
        directory = await fs.open(parent,'r');
        const sensitive = native.caseSensitive(directory.fd);
        // APFS compares canonically equivalent Unicode names. The conservative
        // case fold can serialize distinct names too; it never changes a name.
        let name = basename(physical).normalize('NFD');
        if (!sensitive) name = name.toUpperCase().toLowerCase().normalize('NFD');
        key = join(parent,name);
      } finally { if (directory) await directory.close(); }
      if (exists && !creating) {
        const stat = await fs.stat(physical);
        if (stat.nlink > 1) fail('UNSUPPORTED_STORAGE','Hard-linked files cannot be replaced safely.',{path:physical,reason:'hard_link'});
        if (!stat.isFile()) fail('UNSUPPORTED_STORAGE','The target is not a regular file.',{path:physical,reason:'path_identity'});
      }
      return { path:physical,parent,key,native };
    } catch (error) { throw ioError(error,absolute,'resolve'); }
  }
  async function withLock(target,timeoutMs,work) {
    let handle;
    try {
      const state = join(target.parent,'.mindmap');
      const directory = join(state,'locks');
      for (const path of [state,directory]) {
        await fs.mkdir(path,{mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
        const stat = await fs.lstat(path);
        if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNSUPPORTED_STORAGE','Coordination path identity is unsafe.',{path,reason:'path_identity'});
      }
      const path = join(directory,sha256(target.key) + '.lock');
      handle = await fs.open(path,constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,0o600);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1) fail('UNSUPPORTED_STORAGE','Lock file identity is unsafe.',{path,reason:'path_identity'});
      target.native.nonInheritable(handle.fd);
      const deadline = performance.now() + timeoutMs;
      while (!target.native.tryLock(handle.fd)) {
        const remaining = deadline - performance.now();
        if (remaining <= 0) fail('LOCK_TIMEOUT','Timed out waiting for the commit lock.',{path:target.path,timeoutMs});
        await delay(Math.min(10,remaining));
      }
      return await work();
    } catch (error) { throw ioError(error,target.path,'lock'); }
    finally { if (handle) await handle.close(); }
  }
  async function synchronize(target,operationId) {
    let handle, directory;
    try {
      await hook('beforeReplaySync',{path:target.path,operationId});
      handle = await fs.open(target.path,'r');
      await target.native.syncFile(handle);
      directory = await fs.open(target.parent,'r'); await directory.sync();
    } catch (error) {
      if (!error.code || error.code === 'INTERNAL_ERROR') fail('INTERNAL_ERROR',error.message,{path:target.path,operationId,outcome:'unknown',phase:'replaySync'});
      fail('COMMIT_OUTCOME_UNKNOWN','The visible commit could not be confirmed durable. Retry the same bytes and operation ID.',{path:target.path,operationId,outcome:'unknown',phase:'replaySync',cause:error.message});
    } finally { if (handle) await handle.close(); if (directory) await directory.close(); }
  }
  async function publish(target,document,operationId,mode) {
    const bytes = Buffer.from(JSON.stringify(document) + '\n');
    limit('documentBytes',DOCUMENT_BYTES,bytes.length);
    const temp = join(target.parent,`.mindmap-${sha256(target.key).slice(0,16)}-${randomUUID()}.tmp`);
    let handle, directory, published = false, phase = 'temporaryWrite';
    try {
      handle = await fs.open(temp,'wx',mode);
      await handle.chmod(mode); // Existing mode survives umask on an apply.
      await handle.writeFile(bytes);
      phase = 'temporarySync'; await hook('beforeTemporarySync',{path:target.path,operationId});
      await target.native.syncFile(handle);
      await hook('afterTemporarySync',{path:target.path,operationId});
      await handle.close(); handle = null;
      phase = 'replace'; await hook('beforeReplace',{path:target.path,operationId});
      await fs.rename(temp,target.path); published = true;
      phase = 'directorySync'; await hook('afterReplace',{path:target.path,operationId});
      directory = await fs.open(target.parent,'r'); await directory.sync();
      await directory.close(); directory = null;
      phase = 'response'; await hook('afterDurability',{path:target.path,operationId});
    } catch (error) {
      if (published && (!error.code || error.code === 'INTERNAL_ERROR')) fail('INTERNAL_ERROR',error.message,{path:target.path,operationId,outcome:'unknown',phase});
      if (published) fail('COMMIT_OUTCOME_UNKNOWN','Publication may have completed. Retry exactly the same bytes and operation ID.',{path:target.path,operationId,outcome:'unknown',phase,cause:error.message});
      throw ioError(error,target.path,phase);
    } finally {
      if (handle) await handle.close().catch(() => {});
      if (directory) await directory.close().catch(() => {});
      if (!published) await fs.unlink(temp).catch(() => {});
    }
  }
  async function create(path,args) {
    const target = await identity(path,true);
    return withLock(target,args.lockTimeoutMs ?? 5000,async () => {
      try { await fs.lstat(target.path); fail('ALREADY_EXISTS','Target already exists.',{path:target.path}); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await hook('afterLockedReload',{path:target.path,operationId:null});
      const document = createDocument(args.id ?? randomUUID(),args.title ?? 'Untitled graph');
      await publish(target,document,null,0o600 & ~process.umask());
      return { path:target.path,document };
    });
  }
  async function apply(path,envelope,bytes,args) {
    // Validate the initial snapshot before lock acquisition, then re-read under
    // the lock. Neither the initial observation nor preview authorizes a commit.
    const initial = await read(path);
    try {
      checkIdentity(initial.document,envelope);
      const target = await identity(path,false);
      return await withLock(target,args.lockTimeoutMs ?? 5000,async () => {
        const current = await read(target.path);
        try {
          checkIdentity(current.document,envelope);
          const stat = await fs.stat(target.path);
          if (stat.nlink > 1) fail('UNSUPPORTED_STORAGE','Hard-linked target.',{path:target.path,reason:'hard_link'});
          await hook('afterLockedReload',{path:target.path,operationId:envelope.operationId});
          const requestHash = sha256(bytes);
          const previous = current.document.commits.find(c => c.operationId === envelope.operationId);
          if (previous) {
            if (previous.requestHash !== requestHash) fail('OPERATION_ID_REUSE','Operation ID was committed with different bytes.',{operationId:envelope.operationId,committedGraphVersion:previous.committedGraphVersion});
            await synchronize(target,envelope.operationId);
            return { document:current.document,data:{receipt:previous,replayed:true} };
          }
          const { draft,preview } = edit(current.document,envelope,true);
          const committedAt = new Date().toISOString();
          const receipt = { operationId:envelope.operationId, requestHash, baseGraphVersion:envelope.baseGraphVersion, committedGraphVersion:preview.nextGraphVersion, committedAt, ...(envelope.actor ? {actor:envelope.actor} : {}), affectedNodeIds:preview.affectedNodeIds, affectedEdgeIds:preview.affectedEdgeIds, summary:preview.summary };
          draft.metadata.graphVersion++; draft.metadata.updatedAt = committedAt; draft.commits.push(receipt);
          validateDocument(draft);
          await fs.access(target.path,constants.W_OK);
          await publish(target,draft,envelope.operationId,stat.mode & 0o7777);
          return { document:draft,data:{receipt,replayed:false} };
        } catch (error) { throw observed(ioError(error,target.path,'apply'),current.document); }
      });
    } catch (error) {
      if (error.documentId !== undefined) throw error;
      throw observed(error,initial.document);
    }
  }
  async function doctor(directory) {
    const row = support.find(row => row.os === platform && row.arch === arch && row.nodeVersions.includes(process.versions.node));
    const checks = [{name:'advertisedPlatform',ok:Boolean(row),details:{platform,arch,nodeVersion:process.versions.node}}];
    if (!row) fail('UNSUPPORTED_STORAGE','Platform/runtime not advertised for writes.',{path:directory ? resolve(directory) : '',reason:'platform',checks});
    try { checks.push({name:'adapterAssets',ok:true,details:await adapterAssets(directory ? resolve(directory) : '')}); }
    catch (error) { error.details.checks = checks; throw error; }
    if (!directory) return checks;
    let probe;
    const absolute = resolve(directory);
    try {
      const physical = await fs.realpath(absolute);
      const { filesystem } = await storage(physical);
      checks.push({name:'filesystem',ok:true,details:{filesystem,path:physical}});
      // Confine every artifact, including reusable lock files, to this probe.
      probe = await fs.mkdtemp(join(physical,'.mindmap-probe-'));
      const path = join(probe,'probe.json');
      const target = await identity(path,true);
      await withLock(target,0,async () => {
        const second = await fs.open(join(target.parent,'.mindmap','locks',sha256(target.key) + '.lock'),'r+');
        try {
          if (target.native.tryLock(second.fd)) throw new Error('The second descriptor did not contend');
        } finally { await second.close(); }
        checks.push({name:'kernelLock',ok:true,details:{}});
        await publish(target,createDocument('probe','Storage probe'),null,0o600 & ~process.umask());
        checks.push({name:'durablePublication',ok:true,details:{}});
      });
      return checks;
    } catch (error) {
      const mapped = ioError(error,absolute,'doctor'); mapped.details.checks = checks; throw mapped;
    } finally { if (probe) await fs.rm(probe,{recursive:true,force:true}); }
  }
  return { read,create,apply,doctor };
}

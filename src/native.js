import { fail } from './errors.js';
import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
const require = createRequire(import.meta.url);
export async function adapterAssets(path) {
  try {
    const wrapper = require.resolve('koffi');
    const binary = require.resolve(`@koromix/koffi-${process.platform}-${process.arch}/${process.platform}_${process.arch}/koffi.node`);
    await access(wrapper,constants.R_OK); await access(binary,constants.R_OK);
    return { wrapper,binary };
  } catch (error) { fail('LOCK_UNAVAILABLE','Packaged locking adapter assets are unavailable.',{path,platform:process.platform,reason:error.message}); }
}
let cached;
export async function nativeAdapter(path) {
  if (cached) return cached;
  try {
    const { default: koffi } = await import('koffi');
    const library = koffi.load(process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6');
    const flock = library.func('int flock(int fd, int operation)');
    const fcntl = library.func('int fcntl(int fd, int command, ...)');
    const fpathconf = library.func('long fpathconf(int fd, int name)');
    const error = () => { const errno = koffi.errno(); const code = Object.keys(koffi.os.errno).find(k => koffi.os.errno[k] === errno) ?? `ERRNO_${errno}`; return Object.assign(new Error(`Native operation failed: ${code}`),{code}); };
    cached = {
      tryLock(fd) {
        if (flock(fd,2 | 4) === 0) return true; // LOCK_EX | LOCK_NB
        const e = error();
        if (['EWOULDBLOCK','EAGAIN','EINTR'].includes(e.code)) return false;
        throw e;
      },
      nonInheritable(fd) {
        const current = fcntl(fd,1); // F_GETFD
        if (current < 0 || fcntl(fd,2,'int',current | 1) < 0) throw error(); // F_SETFD, FD_CLOEXEC
      },
      caseSensitive(fd) {
        if (process.platform !== 'darwin') return true;
        const value = fpathconf(fd,11); // Darwin _PC_CASE_SENSITIVE
        if (value < 0) throw error();
        return value !== 0;
      },
      async syncFile(handle) {
        await handle.sync();
        // On macOS request a media-cache flush in addition to ordinary fsync.
        if (process.platform === 'darwin' && fcntl(handle.fd,51) !== 0) throw error(); // F_FULLFSYNC
      },
    };
    return cached;
  } catch (error) {
    fail('LOCK_UNAVAILABLE','The packaged kernel-lock adapter could not load.',{path,platform:process.platform,reason:error.message});
  }
}

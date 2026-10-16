export interface DiskFile { text(): Promise<string>; lastModified: number; size: number }
export interface Writer { write(value: string): Promise<void>; close(): Promise<void>; abort(): Promise<void> }
export interface FileHandle {
  name: string;
  getFile(): Promise<DiskFile>;
  createWritable(): Promise<Writer>;
  queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
export interface Snapshot { source: string; modified: number; size: number }
export class FileReadError extends Error {
  readonly originalName: string;
  readonly phase: 'get-file' | 'read-content';
  readonly permission: PermissionState | 'unknown';
  constructor(cause: unknown, phase: 'get-file' | 'read-content', permission: PermissionState | 'unknown') {
    const originalName = (cause as { name?: string })?.name ?? 'Error';
    const detail = cause instanceof Error ? cause.message : String(cause);
    const denied = originalName === 'NotAllowedError' || originalName === 'SecurityError';
    super(denied ? `浏览器拒绝读取此文件（${originalName}）。请通过“打开其他图”重新选择并授权。` : detail, { cause });
    this.name = 'FileReadError'; this.originalName = originalName; this.phase = phase; this.permission = permission;
  }
}
export async function readSnapshot(handle: FileHandle): Promise<Snapshot> {
  for (let attempt = 0; ; attempt++) {
    let phase: 'get-file' | 'read-content' = 'get-file';
    try {
      const file = await handle.getFile();
      phase = 'read-content';
      return { source: await file.text(), modified: file.lastModified, size: file.size };
    } catch (error) {
      // A File is a disk snapshot. An external edit can invalidate it between getFile and text.
      // Reacquire once; never retry a permission refusal or prompt without user activation.
      if (attempt === 0 && phase === 'read-content' && (error as { name?: string })?.name === 'NotReadableError') continue;
      const permission = await handle.queryPermission({ mode: 'read' }).catch(() => 'unknown' as const);
      throw new FileReadError(error, phase, permission);
    }
  }
}
export const sameSnapshot = (a: Snapshot, b: Snapshot) => a.source === b.source && a.modified === b.modified && a.size === b.size;

/** Owns only the current file. Refresh invalidates every in-flight callback. */
export class FileSession {
  private generation = 0;
  private saving = false;
  private checking = false;
  private stopped = false;
  readonly handle: FileHandle;
  private baseline: Snapshot;
  private refresh: (reason: string) => void;
  private fail: (error: unknown) => void;
  get invalidated() { return this.stopped; }
  constructor(handle: FileHandle, baseline: Snapshot,
    refresh: (reason: string) => void, fail: (error: unknown) => void) {
    this.handle = handle; this.baseline = baseline; this.refresh = refresh; this.fail = fail;
  }
  stop() { this.stopped = true; this.generation++; }
  private changed(reason: string) {
    if (this.stopped) return;
    this.stop(); this.refresh(reason);
  }
  async check(observedChange = false): Promise<void> {
    if (this.stopped) return;
    if (observedChange) { this.changed('disk-change'); return; }
    if (this.checking) return;
    const generation = this.generation;
    this.checking = true;
    try {
      const next = await readSnapshot(this.handle);
      if (this.stopped || generation !== this.generation) return;
      if (!sameSnapshot(this.baseline, next) || observedChange) this.changed('disk-change');
    } catch (error) {
      if (!this.stopped && generation === this.generation) {
        // Access failure is not an empty graph. The UI must discard stale edits.
        this.stop(); this.fail(error);
      }
    } finally { this.checking = false; }
  }
  async save(source: string, permission: Promise<PermissionState>): Promise<boolean> {
    if (this.stopped || this.saving) return false;
    this.saving = true;
    const generation = this.generation;
    let writer: Writer | undefined;
    const active = () => !this.stopped && generation === this.generation;
    try {
      if (await permission !== 'granted') throw new Error('未获得文件写入授权，内容未保存。');
      if (!active()) return false;
      const current = await readSnapshot(this.handle);
      if (!active()) return false;
      if (!sameSnapshot(current, this.baseline)) { this.changed('disk-change-before-save'); return false; }
      writer = await this.handle.createWritable();
      if (!active()) { await writer.abort(); return false; }
      const beforeWrite = await readSnapshot(this.handle);
      if (!active() || !sameSnapshot(beforeWrite, this.baseline)) {
        await writer.abort(); this.changed('disk-change-before-write'); return false;
      }
      await writer.write(source);
      if (!active()) { await writer.abort(); return false; }
      await writer.close(); writer = undefined;
      // A successful close always refreshes, even when serialized bytes were identical.
      if (active()) this.changed('saved');
      return true;
    } catch (error) {
      if (writer) await writer.abort().catch(() => {});
      if (active()) {
        await this.check(); // Partial external writes still outrank the unsaved draft.
        if (active()) this.fail(error);
      }
      return false;
    } finally { this.saving = false; }
  }
}

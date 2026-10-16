import { readSnapshot, type FileHandle, type Snapshot } from './file-session.ts';

/** Automatic refresh retains the live, user-authorized capability, never a stored clone. */
export async function resumeFile(liveHandle: FileHandle | null, restore: () => Promise<FileHandle | null>): Promise<{ handle: FileHandle; snapshot: Snapshot } | null> {
  const handle = liveHandle ?? await restore();
  if (!handle) return null;
  return { handle, snapshot: await readSnapshot(handle) };
}

export interface CapabilityRecords<T> {
  get(key: string): Promise<T | undefined>;
  put(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface SelectionIndex {
  get(): string | null;
  set(key: string): void;
}

/** Preparation must never change the file a concurrent page refresh will restore. */
export function capabilityStore<T>(records: CapabilityRecords<T>, selection: SelectionIndex, nextKey: () => string) {
  return {
    async recall(): Promise<T | null> {
      const key = selection.get();
      if (!key) return null;
      const value = await records.get(key);
      if (value === undefined) throw new Error('文件授权记录不存在，请重新打开图文件。');
      return value;
    },
    async prepare(value: T) {
      const key = nextKey();
      await records.put(key, value);
      let status: 'prepared' | 'committed' | 'discarded' = 'prepared';
      return {
        commit() {
          if (status !== 'prepared') throw new Error('文件选择事务已经结束。');
          // Synchronous commit: callers can retire the old file session in this same task.
          // Do not delete earlier capabilities: a duplicated tab may still reference one.
          selection.set(key);
          status = 'committed';
        },
        async discard() {
          if (status !== 'prepared') return;
          status = 'discarded';
          await records.remove(key);
        },
      };
    },
  };
}

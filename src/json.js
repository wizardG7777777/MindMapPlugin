import { fail, limit } from './errors.js';
export const DOCUMENT_BYTES = 64 * 1024 * 1024;
export const INPUT_BYTES = 8 * 1024 * 1024;

// Scan the already syntactically validated text independently: JSON.parse alone
// silently discards duplicate keys, including keys spelled with Unicode escapes.
function checkTokens(text) {
  const stack = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i++];
    if (c === '{') stack.push({ keys: new Set(), key: true });
    else if (c === '[') stack.push(null);
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') { if (stack.at(-1)) stack.at(-1).key = true; }
    else if (c === '"') {
      const start = i - 1;
      while (i < text.length) {
        if (text[i++] === '\\') i++;
        else if (text[i - 1] === '"') break;
      }
      const object = stack.at(-1);
      if (object?.key) {
        const key = JSON.parse(text.slice(start, i));
        if (object.keys.has(key)) throw new Error(`duplicate key: ${key}`);
        object.keys.add(key);
        object.key = false;
      }
    }
  }
}
export function parseJSON(bytes, source, path) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const value = JSON.parse(text);
    checkTokens(text);
    const pending = [value];
    while (pending.length) {
      const item = pending.pop();
      if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('non-finite number');
      if (item && typeof item === 'object') for (const child of Object.values(item)) pending.push(child);
    }
    return value;
  } catch (error) {
    fail('INVALID_JSON', `Invalid ${source} JSON: ${error.message}`, { source, reason: error.message, ...(path ? { path } : {}) });
  }
}
export async function readBounded(handle, maximum, name) {
  const stat = await handle.stat();
  limit(name, maximum, stat.size);
  if (!stat.isFile()) { const error = new Error('Expected a regular file'); error.code = 'EINVAL'; throw error; }
  const parts = [];
  let total = 0;
  while (true) {
    const buffer = Buffer.alloc(Math.min(65536, maximum + 1 - total));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (!bytesRead) break;
    total += bytesRead;
    limit(name, maximum, total);
    parts.push(buffer.subarray(0, bytesRead));
  }
  return Buffer.concat(parts, total);
}
export async function readStdin(stream) {
  const parts = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    limit('operationInputBytes', INPUT_BYTES, size);
    parts.push(bytes);
  }
  return Buffer.concat(parts, size);
}

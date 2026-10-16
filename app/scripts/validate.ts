import { readFile } from 'node:fs/promises';
import { checkSource } from '../src/check-source.ts';
const path = process.argv[2];
if (!path) { console.error('Usage: npm run validate -- /absolute/path/to/graph.html'); process.exitCode = 2; }
else {
  try {
    const result = checkSource(await readFile(path, 'utf8'));
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 2; }
}

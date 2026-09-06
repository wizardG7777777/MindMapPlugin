import fs from 'node:fs/promises';
import { schemas } from '../src/schemas.js';
import Ajv2020 from 'ajv/dist/2020.js';
const ajv = new Ajv2020({strict:false,ownProperties:true});
for (const [name,schema] of Object.entries(schemas)) {
  if (!ajv.validateSchema(schema)) throw new Error(`${name}: ${ajv.errorsText()}`);
  ajv.compile(schema);
}
await fs.rm(new URL('../dist',import.meta.url),{recursive:true,force:true});
await fs.cp(new URL('../src',import.meta.url),new URL('../dist',import.meta.url),{recursive:true});
await fs.mkdir(new URL('../schemas',import.meta.url),{recursive:true});
for (const [name,schema] of Object.entries(schemas)) await fs.writeFile(new URL(`../schemas/${name}.json`,import.meta.url),JSON.stringify(schema,null,2) + '\n');
await fs.chmod(new URL('../bin/mindmap.js',import.meta.url),0o755);
console.log('Built runtime and four validated JSON Schemas.');

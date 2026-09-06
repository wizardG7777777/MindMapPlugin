import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { schemas } from '../src/schemas.js';
import Ajv2020 from 'ajv/dist/2020.js';
const fontSource=JSON.parse(await fs.readFile(new URL('../assets/fonts/SOURCE.json',import.meta.url),'utf8'));
const fontBytes=await fs.readFile(new URL('../assets/fonts/'+fontSource.file,import.meta.url));
if(createHash('sha256').update(fontBytes).digest('hex')!==fontSource.sha256) throw new Error('Packaged font hash mismatch');
await fs.access(new URL('../assets/fonts/'+fontSource.license,import.meta.url));
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
console.log('Built runtime and validated JSON Schemas.');

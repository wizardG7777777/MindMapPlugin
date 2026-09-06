import { profiles, renderLimits } from './presentation/contracts.js';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { commands, commandMap, optionKey } from './commands.js';
import { schemas } from './schemas.js';
import { limits } from './definitions.js';
import { validateArguments, validateEnvelope } from './validation.js';
import { persistence } from './persistence.js';
import { writeSupport } from './support.js';
import { edit } from './graph.js';
import { context, readNode } from './queries.js';
import { parseJSON, readBounded, readStdin, INPUT_BYTES } from './json.js';
import { argument, ioError, MindmapError, observed, fail } from './errors.js';
const pkg = JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
export const identity = { product:'mindmap-cli',version:pkg.version,cliContractVersion:1,documentSchemaVersions:[2] };
function attempted(argv) {
  const first = argv.find(a => a !== '--json');
  return first === '--version' ? 'version' : first === '--help' ? 'help' : first?.startsWith('-') ? '' : first ?? '';
}
export function parseArguments(argv) {
  let name = attempted(argv);
  if (!argv.length || argv.every(a => a === '--json')) name = 'help';
  if (!Object.hasOwn(commandMap,name) || (['version','help'].includes(name) && argv.includes(name))) argument(name || 'command','unknown command');
  const definition = commandMap[name], args = {}, positionals = [];
  let consumedCommand = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!consumedCommand && (token === name || (name === 'version' && token === '--version') || (name === 'help' && token === '--help'))) { consumedCommand = true; continue; }
    if ((name === 'version' && token === '--version') || (name === 'help' && token === '--help')) argument(token,'repeated option');
    if (!token.startsWith('--')) {
      if (token.startsWith('-')) argument(token,'unknown option');
      positionals.push(token); continue;
    }
    const eq = token.indexOf('=');
    const flag = eq < 0 ? token : token.slice(0,eq);
    const option = definition.options.find(o => o.name === flag);
    if (!option) argument(flag,'unknown option');
    const key = optionKey(flag);
    if (Object.hasOwn(args,key)) argument(flag,'repeated option');
    if (option.valueType === 'boolean') {
      if (eq >= 0) argument(flag,'boolean flags do not accept values');
      args[key] = true; continue;
    }
    const value = eq < 0 ? argv[++i] : token.slice(eq + 1);
    if (value === undefined || value.startsWith('--')) argument(flag,'missing value');
    if (option.valueType === 'integer') {
      if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) argument(flag,'expected nonnegative safe integer');
      args[key] = Number(value);
    } else if (option.valueType === 'string-list') {
      const items = value.split(',');
      if (items.some(v => !v.trim()) || new Set(items).size !== items.length) argument(flag,'empty or duplicate list item');
      if (items.some(v => v !== v.trim())) argument(flag,'list items must be trimmed');
      args[key] = items;
    } else args[key] = value;
  }
  if (positionals.length > definition.arguments.length) argument('positionals','too many arguments');
  definition.arguments.forEach((a,i) => { if (positionals[i] !== undefined) args[a.name] = positionals[i]; });
  validateArguments(name,args);
  if (args.help) return { name:'help',target:name,args };
  for (const option of definition.options) if (option.default !== null && args[optionKey(option.name)] === undefined) args[optionKey(option.name)] = option.default;
  return { name,target:null,args };
}
function help(target) {
  const definition = target ? commandMap[target] : commandMap.help;
  const { usage,description,arguments:args,options,examples } = definition;
  return { usage:target ? usage : 'mindmap <command> [options]', description:target ? description : 'Local directed graphs for people and agents.\n' + commands.map(c => `${c.usage}: ${c.description}`).join('\n'), arguments:args,options,examples };
}
function capabilities() {
  return { ...identity,commands,topologies:['directed'],cycles:true,multipleParents:true,selfLoops:true,parallelEdges:true,disconnectedComponents:true,contextFormats:['json','mermaid'],visualLayouts:profiles,renderFormats:['svg','mermaid'],renderLimits,requiresServer:false,offlineGraphCommands:true,limits,storage:{writeSupport,readsRequireLockAdapter:false} };
}
async function operationInput(path,stdin) {
  let bytes;
  if (path === '-') bytes = await readStdin(stdin);
  else {
    const absolute = resolve(path); let handle;
    try { handle = await fs.open(absolute,'r'); bytes = await readBounded(handle,INPUT_BYTES,'operationInputBytes'); }
    catch (error) { throw ioError(error,absolute,'input'); }
    finally { if (handle) await handle.close(); }
  }
  return { bytes,envelope:validateEnvelope(parseJSON(bytes,'input',path === '-' ? undefined : resolve(path))) };
}
export async function execute(parsed,{store = persistence(),stdin = process.stdin} = {}) {
  const {name,args,target} = parsed;
  if (name === 'version') return {data:identity};
  if (name === 'help') return {data:help(target)};
  if (name === 'capabilities') return {data:capabilities()};
  if (name === 'schema') return {data:schemas[args.name]};
  if (name === 'doctor') {
    const checks = await store.doctor(args.directory);
    return {data:{identity,platform:{os:process.platform,arch:process.arch,nodeVersion:process.versions.node},checks,supported:checks.every(c => c.ok)}};
  }
  if (name === 'create') { const result = await store.create(args.document,args); return {document:result.document,data:result}; }
  const input = ['preview','apply'].includes(name) ? await operationInput(args.input,stdin) : null;
  if (name === 'apply') return store.apply(args.document,input.envelope,input.bytes,args);
  const {document,path} = await store.read(args.document);
  try {
    const counts = {nodeCount:Object.keys(document.graph.nodes).length,edgeCount:Object.keys(document.graph.edges).length,commitCount:document.commits.length};
    let data;
    switch (name) {
      case 'inspect': {
        if (args.operationId) {
          const receipt = document.commits.find(r => r.operationId === args.operationId);
          if (!receipt) fail('NOT_FOUND','Operation receipt does not exist.',{kind:'receipt',id:args.operationId});
          data = {path,receipt};
        } else {
          const relationCounts = Object.create(null);
          for (const e of Object.values(document.graph.edges)) relationCounts[e.kind] = (relationCounts[e.kind] ?? 0) + 1;
          data = {path,metadata:document.metadata,topology:document.graph.topology,semanticType:document.graph.semanticType,entryNodeId:document.graph.entryNodeId,...counts,relationCounts};
        }
        break;
      }
      case 'render': { const {renderDocument} = await import('./presentation/render.js'); data = await renderDocument(document,args); break; }
      case 'export': data = {path,document}; break;
      case 'validate': data = {valid:true,documentSchemaVersion:2,...counts}; break;
      case 'node': data = readNode(document,args); break;
      case 'neighbors': data = context(document,args,true); break;
      case 'context': data = context(document,args); break;
      case 'preview': data = edit(document,input.envelope).preview; break;
      default: throw new Error('No handler for ' + name);
    }
    if (['context','neighbors'].includes(name) && args.layoutHints) {
      const {layoutDocument} = await import('./presentation/layout.js');
      const {projectMermaid} = await import('./presentation/mermaid.js');
      const selected = new Set(data.nodes.map(n => n.id));
      const subset = {metadata:document.metadata,graph:{...document.graph,entryNodeId:selected.has(document.graph.entryNodeId) ? document.graph.entryNodeId : null,nodes:Object.fromEntries(data.nodes.map(n => [n.id,{...document.graph.nodes[n.id],title:n.title,meta:structuredClone(document.graph.nodes[n.id].meta)}])),edges:Object.fromEntries(data.edges.map(e => [e.id,e]))}};
      const omitted = [];
      for (const n of Object.values(subset.graph.nodes)) if (n.meta.flow?.mergeNodeId && !selected.has(n.meta.flow.mergeNodeId)) { omitted.push(n.id); delete n.meta.flow.mergeNodeId; }
      const layout = await layoutDocument(subset,{layout:args.layout,orientation:args.orientation});
      if (omitted.length) layout.warnings.push({code:'MERGE_OUTSIDE_SCOPE',message:'A decision merge lies outside this selected context.',nodeIds:omitted,edgeIds:[]});
      data.mermaid = projectMermaid(data.nodes,data.edges,layout.orientation,{entryNodeId:layout.entryNodeId,sourceNodes:subset.graph.nodes,layoutHints:layout});
    }
    return {document,data};
  } catch (error) { throw observed(error,document); }
}
export async function runCLI(argv = process.argv.slice(2),{stdout = process.stdout,stderr = process.stderr,...dependencies} = {}) {
  let name = attempted(argv), result, exitCode, raw = false;
  const json = argv.includes('--json');
  try {
    const parsed = parseArguments(argv); name = parsed.name; raw = parsed.name === 'render' && parsed.args.raw;
    const {document,data} = await execute(parsed,dependencies);
    result = {ok:true,cliContractVersion:1,command:name,documentId:document?.metadata.id ?? null,graphVersion:document?.metadata.graphVersion ?? null,data,error:null}; exitCode = 0;
  } catch (error) {
    const failure = error instanceof MindmapError ? error : new MindmapError('INTERNAL_ERROR',error.message,{outcome:'not_published',phase:'command'});
    result = {ok:false,cliContractVersion:1,command:name,documentId:error.documentId ?? null,graphVersion:error.graphVersion ?? null,data:null,error:{code:failure.code,message:failure.message,details:failure.details}}; exitCode = failure.exitCode;
  }
  const rawFailure = !result.ok && name === 'render' && argv.includes('--raw') && !json;
  const text = raw && result.ok ? result.data.text : JSON.stringify(result,null,json ? undefined : 2) + '\n';
  const destination = rawFailure ? stderr : stdout;
  await new Promise((resolve,reject) => destination.write(text,error => error ? reject(error) : resolve()));
  return exitCode;
}

import { obj, arr, str, bool, integer, id, text, dialect, queryDefaults, queryMaximums } from './definitions.js';
export const optionKey = name => name.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const option = (name, valueType, description, extras = {}) => ({ name, valueType, required: false, default: null, enum: null, bounds: null, description, ...extras });
const flag = (name, description) => option(name, 'boolean', description);
const number = (name, defaultValue, min, max, description) => option(name, 'integer', description, { default: defaultValue, bounds: { min, max } });
const globalOptions = [flag('--json', 'Return exactly one JSON result.'), flag('--help', 'Show help without requiring a document.')];
const positional = (name, description, values = null) => ({ name, required: true, values, description });
const documentArg = positional('document', 'Explicit graph file path.');
const input = option('--input', 'string', 'Operation file path, or - for stdin.', { required: true });
const idOption = option('--id', 'string', 'Canonical node ID.', { required: true });
const lockTimeout = number('--lock-timeout-ms', 5000, 0, 60000, 'Maximum commit lock wait; zero tries once.');
const content = option('--content', 'string', 'Node content to return.', { default: 'card', enum: ['title', 'card', 'all'] });
const maxText = number('--max-text-bytes', 4096, 0, 1048576, 'Bytes per selected text field; zero returns complete text.');
const contextOptions = [
  option('--direction', 'string', 'Relationship traversal direction.', { default: 'outgoing', enum: ['outgoing', 'incoming', 'both'] }),
  option('--kinds', 'string-list', 'Exact relationship kinds, separated by commas.'), content,
  ...['maxNodes', 'maxEdges', 'maxBoundaryEdges'].map(key => number('--' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), queryDefaults[key], key === 'maxBoundaryEdges' ? 0 : 1, queryMaximums[key], 'Maximum returned ' + key.slice(3).toLowerCase() + '.')),
  maxText, flag('--mermaid', 'Include structural Mermaid text and canonical ID mappings.'),
  option('--orientation', 'string', 'Mermaid direction; requires --mermaid.', { default: 'LR', enum: ['LR', 'TD'] }),
];
const records = [
  ['version', 'mindmap --version', 'Identify the executable and supported protocol versions.', [], [], ['mindmap --version --json']],
  ['help', 'mindmap --help | mindmap <command> --help', 'Read commands and options.', [], [], ['mindmap context --help']],
  ['capabilities', 'mindmap capabilities', 'Discover commands, schemas, limits and tested storage support.', [], [], ['mindmap capabilities --json']],
  ['schema', 'mindmap schema <name>', 'Return a complete JSON Schema.', [positional('name', 'Schema name.', ['document', 'operations', 'context', 'result'])], [], ['mindmap schema operations --json']],
  ['create', 'mindmap create <document>', 'Create an empty graph; never overwrite an existing file.', [documentArg], [option('--title', 'string', 'Document title.', { default: 'Untitled graph' }), option('--id', 'string', 'Document ID; generated UUID when absent.'), lockTimeout], ['mindmap create ./plan.json --id plan --json']],
  ['inspect', 'mindmap inspect <document>', 'Read document counts or a committed operation receipt.', [documentArg], [option('--operation-id', 'string', 'Exact committed operation ID.')], ['mindmap inspect ./plan.json --json']],
  ['export', 'mindmap export <document>', 'Read the complete document and all receipts without query truncation.', [documentArg], [], ['mindmap export ./plan.json --json']],
  ['node', 'mindmap node <document> --id <id>', 'Read selected fields of one node.', [documentArg], [idOption, content, maxText], ['mindmap node ./plan.json --id a --content all --max-text-bytes 0 --json']],
  ['neighbors', 'mindmap neighbors <document> --id <id>', 'Read one-hop context with independent selectors.', [documentArg], [idOption, ...contextOptions], ['mindmap neighbors ./plan.json --id c --direction incoming --kinds next --json']],
  ['context', 'mindmap context <document> (--all | --nodes <ids> | --edges <ids>)', 'Read an explicitly selected, bounded graph snapshot; node and edge seeds can be combined.', [documentArg], [flag('--all', 'Select all nodes, including disconnected ones.'), option('--nodes', 'string-list', 'Canonical seed node IDs.'), option('--edges', 'string-list', 'Canonical seed edge IDs.'), number('--depth', 0, 0, 100, 'Expansion steps from explicit seeds.'), ...contextOptions], ['mindmap context ./plan.json --all --mermaid --json', 'mindmap context ./plan.json --nodes a --depth 2 --json']],
  ['preview', 'mindmap preview <document> --input <file-or-dash>', 'Validate and predict the whole batch without reserving a version.', [documentArg], [input], ['mindmap preview ./plan.json --input changes.json --json']],
  ['apply', 'mindmap apply <document> --input <file-or-dash>', 'Commit a batch transactionally or replay its exact original bytes.', [documentArg], [input, lockTimeout], ['mindmap apply ./plan.json --input changes.json --json']],
  ['validate', 'mindmap validate <document>', 'Validate the full stored graph and receipt chain.', [documentArg], [], ['mindmap validate ./plan.json --json']],
  ['doctor', 'mindmap doctor', 'Check environment; probe storage only with an explicit directory.', [], [option('--directory', 'string', 'Existing directory in which to create temporary storage probes.')], ['mindmap doctor --json', 'mindmap doctor --directory . --json']],
];
function optionSchema(opt) {
  const key = optionKey(opt.name);
  let value = opt.valueType === 'boolean' ? { const: true } : opt.valueType === 'integer' ? { ...integer, minimum: opt.bounds.min, maximum: opt.bounds.max } : opt.valueType === 'string-list' ? arr(['nodes', 'edges'].includes(key) ? id : text, { uniqueItems: true, minItems: 1 }) : ['id', 'operationId'].includes(key) ? id : text;
  if (opt.enum) value = { ...value, enum: opt.enum };
  return value;
}
function commandSchema(name, args, options) {
  const properties = Object.fromEntries([...args.map(a => [a.name, a.values ? { enum: a.values } : text]), ...options.map(o => [optionKey(o.name), optionSchema(o)])]);
  const required = [...args.filter(a => a.required).map(a => a.name), ...options.filter(o => o.required).map(o => optionKey(o.name))];
  const constraints = [];
  if (name === 'context') constraints.push({ oneOf: [
    { required: ['all'], not: { anyOf: ['nodes','edges','direction','depth'].map(k => ({ required: [k] })) } },
    { not: { required: ['all'] }, anyOf: [{ required: ['nodes'] }, { required: ['edges'] }] },
  ] });
  if (['context', 'neighbors'].includes(name)) constraints.push({ if: { required: ['orientation'] }, then: { required: ['mermaid'] } });
  return { $schema: dialect, ...obj(properties, []), allOf: [{ if: { not: { required: ['help'] } }, then: { required, ...(constraints.length ? { allOf: constraints } : {}) } }] };
}
export const commands = records.map(([name, usage, description, args, options, examples]) => {
  const effective = [...options, ...globalOptions];
  return { name, usage, description, arguments: args, options: effective, inputSchema: commandSchema(name, args, effective), resultRef: `#/$defs/${name}Success`, examples };
}).sort((a, b) => a.name < b.name ? -1 : 1);
export const commandMap = Object.fromEntries(commands.map(c => [c.name, c]));

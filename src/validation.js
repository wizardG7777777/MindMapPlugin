import Ajv2020 from 'ajv/dist/2020.js';
import { schemas } from './schemas.js';
import { commands } from './commands.js';
import { fail, limit } from './errors.js';
const ajv = new Ajv2020({ strict: false, allErrors: false, ownProperties: true });
const validators = new Map();
export function validator(name) {
  if (!validators.has(name)) validators.set(name, ajv.compile(schemas[name]));
  return validators.get(name);
}
const commandValidators = new Map();
export function validateArguments(command, value) {
  if (!commandValidators.has(command)) commandValidators.set(command, ajv.compile(commands.find(c => c.name === command).inputSchema));
  const check = commandValidators.get(command);
  if (!check(value)) {
    const e = check.errors[0];
    fail('INVALID_ARGUMENT', `Invalid command arguments: ${e.message}`, { argument: e.instancePath || e.params.missingProperty || e.params.additionalProperty || command, reason: e.message });
  }
}
function assertSchema(name, value, code) {
  const check = validator(name);
  if (!check(value)) {
    const e = check.errors[0];
    const field = (e.instancePath + (e.params.missingProperty ? '/' + e.params.missingProperty : '')).replace(/^\//, '') || e.params.additionalProperty || '';
    fail(code, `Invalid ${name}: ${field} ${e.message}`, { field, reason: e.message });
  }
}
export function validateEnvelope(value) {
  if (Array.isArray(value?.operations)) limit('operationsPerBatch', 10000, value.operations.length);
  assertSchema('operations', value, 'INVALID_ENVELOPE');
  return value;
}
export const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export const sorted = values => [...values].sort(compare);
export const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function validateDocument(value) {
  if (value && typeof value === 'object' && Object.hasOwn(value, 'JSON-SchemaVersion') && value['JSON-SchemaVersion'] !== 2) fail('UNSUPPORTED_SCHEMA', 'Unsupported document schema.', { actualVersion: value['JSON-SchemaVersion'], supportedVersions: [2] });
  assertSchema('document', value, 'INVALID_DOCUMENT');
  const invalid = (field, reason) => fail('INVALID_DOCUMENT', `Invalid document ${field}: ${reason}`, { field, reason });
  const { metadata, graph, commits } = value;
  for (const [field, date] of [['metadata.createdAt',metadata.createdAt], ['metadata.updatedAt',metadata.updatedAt], ...commits.map((c,i) => [`commits.${i}.committedAt`,c.committedAt])]) {
    if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date) invalid(field, 'invalid timestamp');
  }
  for (const [field, title] of [['metadata.title',metadata.title], ['graph.semanticType',graph.semanticType]]) if (title !== title.trim()) invalid(field,'must be trimmed');
  for (const [key,node] of Object.entries(graph.nodes)) {
    if (key !== node.id) invalid(`graph.nodes.${key}.id`, 'map key must match record ID');
    if (node.title !== node.title.trim()) invalid(`graph.nodes.${key}.title`, 'must be trimmed');
  }
  for (const [key,edge] of Object.entries(graph.edges)) {
    if (key !== edge.id) invalid(`graph.edges.${key}.id`, 'map key must match record ID');
    if (edge.kind !== edge.kind.trim()) invalid(`graph.edges.${key}.kind`, 'must be trimmed');
    for (const endpoint of ['source','target']) if (!Object.hasOwn(graph.nodes,edge[endpoint])) invalid(`graph.edges.${key}.${endpoint}`, 'missing endpoint');
  }
  if (graph.entryNodeId !== null && !Object.hasOwn(graph.nodes,graph.entryNodeId)) invalid('graph.entryNodeId','missing entry node');
  if (commits.length !== metadata.graphVersion) invalid('commits','receipt count must equal graph version');
  const seen = new Set();
  for (const [i,receipt] of commits.entries()) {
    if (receipt.baseGraphVersion !== i || receipt.committedGraphVersion !== i + 1) invalid(`commits.${i}`, 'nonconsecutive receipt versions');
    if (seen.has(receipt.operationId)) invalid(`commits.${i}.operationId`, 'duplicate operation ID');
    seen.add(receipt.operationId);
    for (const field of ['affectedNodeIds','affectedEdgeIds']) if (!equal(receipt[field],sorted(receipt[field]))) invalid(`commits.${i}.${field}`, 'IDs must be sorted and unique');
    if (receipt.summary.nodeCount !== receipt.affectedNodeIds.length || receipt.summary.edgeCount !== receipt.affectedEdgeIds.length) invalid(`commits.${i}.summary`, 'affected counts mismatch');
  }
  if (metadata.updatedAt !== (commits.at(-1)?.committedAt ?? metadata.createdAt)) invalid('metadata.updatedAt','must match the last commit, or creation when empty');
  return value;
}

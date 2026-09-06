import { profiles, renderLimits, layoutShape, renderData, flowNode, flowEdge } from './presentation/contracts.js';
import { obj, arr, str, bool, nil, integer, id, nullable, meta, document, metadata, receipt, selectedNode, fieldOmission, context, operations, preview, limits, queryLimits, schema, dialect, operationTypes } from './definitions.js';
import { errorGroups } from './errors.js';
export const identityShape = obj({ product: { const: 'mindmap-cli' }, version: str, cliContractVersion: { const: 1 }, documentSchemaVersions: { const: [2] } });
const schemaShape = { type: 'object', properties: { $schema: { const: dialect }, $id: str }, required: ['$schema'], additionalProperties: true };
const option = obj({ name: str, valueType: { enum: ['boolean','string','integer','string-list'] }, required: bool, default: { $ref: '#/$defs/jsonValue' }, enum: nullable(arr({ $ref: '#/$defs/jsonValue' })), bounds: nullable(obj({ min: integer, max: integer })), description: str });
const positional = obj({ name: str, required: bool, values: nullable(arr(str)), description: str });
const help = obj({ usage: str, description: str, arguments: arr(positional), options: arr(option), examples: arr(str) });
const commandDefinition = obj({ name: str, ...help.properties, inputSchema: schemaShape, resultRef: str });
const check = obj({ name: str, ok: bool, details: meta });
const support = obj({ os: str, arch: str, filesystems: arr(str), nodeVersions: arr(str) });
export const dataShapes = {
  version: identityShape, help,
  capabilities: obj({ ...identityShape.properties, commands: arr(commandDefinition), topologies: { const: ['directed'] }, cycles: { const: true }, multipleParents: { const: true }, selfLoops: { const: true }, parallelEdges: { const: true }, disconnectedComponents: { const: true }, contextFormats: { const: ['json','mermaid'] }, visualLayouts: { const: profiles }, renderFormats: { const: ['svg','mermaid'] }, renderLimits: { const: renderLimits }, requiresServer: { const: false }, offlineGraphCommands: { const: true }, limits: obj(Object.fromEntries(Object.entries(limits).map(([k,v]) => [k, { const: v }]))), storage: obj({ writeSupport: arr(support), readsRequireLockAdapter: { const: false } }) }),
  schema: schemaShape,
  render: renderData,
  create: obj({ path: str, document }),
  inspect: { oneOf: [obj({ path: str, metadata, topology: { const: 'directed' }, semanticType: str, entryNodeId: nullable(id), nodeCount: integer, edgeCount: integer, relationCounts: { type: 'object', additionalProperties: integer }, commitCount: integer }), obj({ path: str, receipt })] },
  export: obj({ path: str, document }),
  node: obj({ node: selectedNode, omissions: obj({ fields: arr(fieldOmission) }) }),
  neighbors: context, context, preview,
  apply: obj({ receipt, replayed: bool }),
  validate: obj({ valid: { const: true }, documentSchemaVersion: { const: 2 }, nodeCount: integer, edgeCount: integer, commitCount: integer }),
  doctor: obj({ identity: identityShape, platform: obj({ os: str, arch: str, nodeVersion: str }), checks: arr(check), supported: bool }),
};
const detailProperties = {
  INVALID_ARGUMENT: { argument: str, reason: str }, INVALID_JSON: { source: { enum: ['input','document'] }, reason: str },
  INVALID_ENVELOPE: { field: str, reason: str }, DOCUMENT_NOT_FOUND: { path: str }, ALREADY_EXISTS: { path: str },
  UNSUPPORTED_SCHEMA: { actualVersion: { $ref: '#/$defs/jsonValue' }, supportedVersions: { const: [2] } },
  INVALID_DOCUMENT: { field: str, reason: str }, NOT_FOUND: { kind: { enum: ['node','edge','receipt'] }, id },
  INVALID_LAYOUT: { reason: str, nodeIds: arr(id), edgeIds: arr(id) },
  INVALID_OPERATION: { reason: str }, SCOPE_VIOLATION: { nodeIds: arr(id), edgeIds: arr(id), documentFields: arr(str), reason: str },
  LIMIT_EXCEEDED: { limit: str, maximum: integer, actual: integer }, OPERATION_ID_REUSE: { operationId: id, committedGraphVersion: integer },
  CONFLICT: { expectedVersion: integer, currentVersion: integer }, LOCK_TIMEOUT: { path: str, timeoutMs: integer },
  LOCK_UNAVAILABLE: { path: str, platform: str, reason: str }, IO_ERROR: { path: str, phase: str, osCode: nullable(str) },
  UNSUPPORTED_STORAGE: { path: str, reason: { enum: ['hard_link','path_identity','platform','filesystem'] } },
  COMMIT_OUTCOME_UNKNOWN: { path: str, operationId: nullable(id), outcome: { const: 'unknown' }, phase: str },
  INTERNAL_ERROR: { outcome: { enum: ['not_published','unknown'] }, phase: str },
};
const envelope = (ok, command, data, error, documentId = nullable(id), graphVersion = nullable(integer)) => obj({ ok: { const: ok }, cliContractVersion: { const: 1 }, command, documentId, graphVersion, data, error });
const noDocument = new Set(['version','help','capabilities','schema','doctor']);
const successes = Object.fromEntries(Object.entries(dataShapes).map(([command,data]) => [`${command}Success`, envelope(true, { const: command }, data, nil, noDocument.has(command) ? nil : id, noDocument.has(command) ? nil : integer)]));
const errors = Object.values(errorGroups).flat().map(code => {
  const properties = detailProperties[code];
  return envelope(false, str, nil, obj({ code: { const: code }, message: str, details: { ...obj(properties), additionalProperties: { $ref: '#/$defs/jsonValue' } } }));
});
const operationError = errors.find(s => s.properties.error.properties.code.const === 'INVALID_OPERATION');
operationError.properties.error.properties.details = { oneOf: [
  { ...obj({ reason:{const:'invalid_final_graph'},field:str }),additionalProperties:{$ref:'#/$defs/jsonValue'} },
  { ...obj({ reason:{enum:['id_exists','target_missing','endpoint_missing']},operationIndex:integer,type:{enum:Object.keys(operationTypes)},id }),additionalProperties:{$ref:'#/$defs/jsonValue'} },
  { ...obj({ reason:{const:'edge_set_mismatch'},operationIndex:integer,type:{const:'reorderEdges'},expectedEdgeIds:arr(id),actualEdgeIds:arr(id) }),additionalProperties:{$ref:'#/$defs/jsonValue'} },
] };
// Apply conflicts additionally prove that this ID has no receipt in the checked snapshot.
const conflict = errors.find(s => s.properties.error.properties.code.const === 'CONFLICT');
conflict.allOf = [{ if: { properties: { command: { const: 'apply' } } }, then: { properties: { error: { properties: { details: { required: ['operationId','committed'], properties: { operationId: id, committed: { const: false } } } } } } } }];
export const schemas = {
  layout: schema('layout', layoutShape, { flowNode, flowEdge }),
  document: schema('document', document),
  operations: schema('operations', operations),
  context: schema('context', context),
  result: schema('result', { oneOf: [...Object.keys(successes).map(k => ({ $ref: '#/$defs/' + k })), ...errors] }, successes),
};

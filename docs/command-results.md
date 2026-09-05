# Command Result Data

Status: target CLI contract version 1. This is the exact per-command success `data` contract referenced by [command contract](command-contract.md). The [CLI reference](cli-reference.md) is a usage catalog, not an alternative schema.

## Common types

All object shapes below are closed unless explicitly defined as a map or JSON Schema. All listed fields are required unless marked optional. Strings, booleans, arrays, nullable fields and nonnegative safe integers retain their JSON types; counts cannot be floating point. `Path` is an absolute physical document/probe path resolved by persistence. `Document`, `Node`, `Edge`, `Receipt` and `Actor` are exactly the types in [data model](data-model.md). A content-selected `Node` follows the query contract instead of requiring omitted content fields.

`Schema` is a complete JSON Schema using `$schema: "https://json-schema.org/draft/2020-12/schema"`. Exported schemas have `$id` equal to `urn:mindmap-cli:contract:1:<name>` for document, operations, context or result. They carry all relevant field/union definitions rather than requiring a separately registered tool to supply them.

`Identity` is `{product: "mindmap-cli", version: string, cliContractVersion: 1, documentSchemaVersions: [2]}`. Version is the actual package release version, not a graph version.

`Option` is `{name: string, valueType: "boolean"|"string"|"integer"|"string-list", required: boolean, default: JSON value, enum: array|null, bounds: {min: integer, max: integer}|null, description: string}`. Name includes `--`; boolean means a presence flag. Null default means absent unless its input schema expressly permits null. Enum/bounds are null when inapplicable. Options are single-valued; string lists use the documented comma shorthand.

`Positional` is `{name: string, required: boolean, values: string[]|null, description: string}`. `CommandDefinition` is `{name: string, usage: string, description: string, arguments: Positional[], options: Option[], inputSchema: Schema, resultRef: string, examples: string[]}`. `inputSchema` defines the parsed argument object, including positional keys and camelCase option keys, cross-option restrictions and additionalProperties false. `resultRef` names a definition inside the exported result schema. Discovery includes effective global options such as `--json` and `--help`. Definitions for version/help describe their documented flag invocation, not unadvertised subcommands.

## Exact success data by command

| Command | `data` shape |
| --- | --- |
| `version` | `Identity` |
| `help` | `{usage: string, description: string, arguments: Positional[], options: Option[], examples: string[]}`. Root help lists the catalog in description/usage; command help describes that command. |
| `capabilities` | Shape below |
| `schema` | `Schema` itself, selected by requested name |
| `create` | `{path: Path, document: Document}` |
| `inspect` without operation ID | `{path: Path, metadata: Document.metadata, topology: "directed", semanticType: string, entryNodeId: string|null, nodeCount: integer, edgeCount: integer, relationCounts: map<string, integer>, commitCount: integer}` |
| `inspect` with operation ID | `{path: Path, receipt: Receipt}` |
| `export` | `{path: Path, document: Document}`; complete normalized snapshot, without query truncation |
| `node` | `{node: content-selected Node, omissions: {fields: FieldOmission[]}}` |
| `neighbors`, `context` | Exact context object in [context management](context-management.md) |
| `preview` | Exact preview object in [operation schema](operation-schema.md); no prose-only substitute |
| `apply` | `{receipt: Receipt, replayed: boolean}` |
| `validate` | `{valid: true, documentSchemaVersion: 2, nodeCount: integer, edgeCount: integer, commitCount: integer}` |
| `doctor` | `{identity: Identity, platform: {os: string, arch: string, nodeVersion: string}, checks: Check[], supported: boolean}` |

`FieldOmission` is `{nodeId: string, field: "title"|"cardContent"|"notes"|"meta", reason: "not_requested"|"text_limit", omittedBytes: integer}`. `Check` is `{name: string, ok: boolean, details: map<string, JSON value>}`; details permit platform-specific diagnostics. Doctor's supported value equals the conjunction of check results. Failures use the common error envelope rather than this success shape.

## Capabilities shape

Capabilities has all Identity fields plus:

- `commands`: `CommandDefinition[]`, sorted by command name, covering the full CLI reference catalog.
- `topologies`: `["directed"]`.
- `cycles`, `multipleParents`, `selfLoops`, `parallelEdges`, `disconnectedComponents`: all true.
- `contextFormats`: `["json", "mermaid"]`; `visualLayouts`: an empty string array; `requiresServer`: false; `offlineGraphCommands`: true.
- `limits`: `{documentBytes: 67108864, operationInputBytes: 8388608, operationsPerBatch: 10000, idMaxCharacters: 128, queryDefaults: QueryLimits, queryMaximums: QueryLimits, depthMaximum: 100, lockTimeoutDefaultMs: 5000, lockTimeoutMaximumMs: 60000}`.
- `storage`: `{writeSupport: Support[], readsRequireLockAdapter: false}`. `Support` is `{os: string, arch: string, filesystems: string[], nodeVersions: string[]}` listing actual tested combinations and exact tested Node versions. An empty writeSupport list means writes cannot be advertised as ready.

`QueryLimits` has `{maxNodes: integer, maxEdges: integer, maxBoundaryEdges: integer, maxTextBytes: integer}`. Defaults are 200, 400, 100, 4096; positive maximums are 10000, 20000, 20000, 1048576 respectively. Zero for maxTextBytes explicitly requests complete selected text, bounded by document size; the other query limits follow CLI reference. `export` is the untruncated discovery/data path when a context cannot include every record.

## Stable error details

All failures have the envelope/code/exit status from command contract. `details` permits diagnostic extensions, but these fields are mandatory for the specified codes:

| Code | Required details |
| --- | --- |
| `CONFLICT` | `expectedVersion`, `currentVersion`; for apply additionally `operationId`, `committed: false` (no receipt for that ID in the checked snapshot) |
| `OPERATION_ID_REUSE` | `operationId`, `committedGraphVersion` |
| `UNSUPPORTED_SCHEMA` | `actualVersion`, `supportedVersions: [2]` |
| `NOT_FOUND` | `kind: "node"|"edge"|"receipt"`, `id` |
| `SCOPE_VIOLATION` | `nodeIds`, `edgeIds`, `documentFields`, `reason`; arrays list violating IDs/fields, not all affected targets |
| `LIMIT_EXCEEDED` | `limit`, `maximum`, `actual`; explicit-selection failures also provide `requiredMinimum` |
| `LOCK_TIMEOUT` | `path`, `timeoutMs` |
| `COMMIT_OUTCOME_UNKNOWN` | `path`, `operationId: string|null`, `outcome: "unknown"`, `phase` |

A validly shaped envelope with a different documentId uses `INVALID_ENVELOPE` and `{field: "documentId", expected, actual}`; unsupported envelope versions use the same code and field `envelopeVersion`. Invalid scope shape is `INVALID_ENVELOPE`; a valid scope exceeded by effects is `SCOPE_VIOLATION`. Operation shape errors are `INVALID_ENVELOPE`; an operation invalid against the evolving graph is `INVALID_OPERATION`. Other diagnostics follow command contract. Error messages are readable text, not stable parsing keys.

## Rejection conditions

These mappings make negative tests deterministic. `operationIndex` is zero-based; IDs are canonical IDs.

| Condition | Code / exit | Required details |
| --- | --- | --- |
| Unknown command/flag, invalid option value, conflicting selectors, empty/duplicate selector item | `INVALID_ARGUMENT` / 2 | `argument`, `reason` |
| Invalid UTF-8, malformed JSON or duplicate JSON object key in input/document | `INVALID_JSON` / 2 | `source: "input"|"document"`, `reason`; `path` when file-backed |
| Envelope shape/version/identity failure | `INVALID_ENVELOPE` / 2 | `field`, `reason`; identity mismatch also `expected`, `actual` |
| Target file absent | `DOCUMENT_NOT_FOUND` / 3 | `path` |
| Create target already exists, regardless of its validity | `ALREADY_EXISTS` / 3 | `path` |
| Parsed schema-2 document violates a field, endpoint or receipt invariant | `INVALID_DOCUMENT` / 3 | `field`, `reason` |
| Add reuses an existing node/edge ID | `INVALID_OPERATION` / 3 | `operationIndex`, `type`, `id`, `reason: "id_exists"` |
| Operation target absent at its execution step | `INVALID_OPERATION` / 3 | `operationIndex`, `type`, `id`, `reason: "target_missing"` |
| Edge operation endpoint absent | `INVALID_OPERATION` / 3 | `operationIndex`, `type`, `id` (missing node), `reason: "endpoint_missing"` |
| Reorder list is not the exact current source/kind set | `INVALID_OPERATION` / 3 | `operationIndex`, `type`, `reason: "edge_set_mismatch"`, `expectedEdgeIds`, `actualEdgeIds` |
| Final draft violates entry or graph invariants | `INVALID_OPERATION` / 3 | `reason: "invalid_final_graph"`, `field` |
| OS denies file access or a pre-publication I/O primitive fails | `IO_ERROR` / 5 | `path`, `phase`, `osCode` (string or null) |
| Hard-linked mutation, unsafe path identity, unsupported platform or filesystem | `UNSUPPORTED_STORAGE` / 5 | `path`, `reason: "hard_link"|"path_identity"|"platform"|"filesystem"` |
| Missing or unloadable kernel-lock adapter on an otherwise advertised supported platform | `LOCK_UNAVAILABLE` / 5 | `path`, `platform`, `reason` |
| Unexpected defect | `INTERNAL_ERROR` / 6 | `outcome: "not_published"|"unknown"`, `phase` |

Normal JSON schema field/bounds failures are `INVALID_ENVELOPE` for mutation input and `INVALID_DOCUMENT` for persisted content. Byte/operation-count/output limits are `LIMIT_EXCEEDED`, rather than a generic validation error. Input operation count is checked before graph loading. All graph validation codes leave committed bytes unchanged unless the error expressly reports an uncertain publication outcome.

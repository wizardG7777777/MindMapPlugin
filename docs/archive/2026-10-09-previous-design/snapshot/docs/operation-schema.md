# Operation Schema

Status: target operation envelope version 1. This is the only definition of mutation payloads; CLI syntax lives in [CLI reference](cli-reference.md).

## Envelope

```json
{
  "envelopeVersion": 1,
  "documentId": "plan",
  "baseGraphVersion": 0,
  "operationId": "build-cycle-1",
  "actor": {"kind": "agent", "name": "planner"},
  "scope": {"mode": "document", "allowDelete": false},
  "operations": [
    {"type": "addNode", "node": {"id": "a", "title": "A"}},
    {"type": "addNode", "node": {"id": "b", "title": "B"}},
    {"type": "addEdge", "edge": {"id": "ab", "source": "a", "target": "b", "kind": "next"}},
    {"type": "addEdge", "edge": {"id": "ba", "source": "b", "target": "a", "kind": "next"}}
  ]
}
```

All envelope fields except `actor` are required. `envelopeVersion` is 1; `documentId` must match the loaded file; `baseGraphVersion` is a nonnegative safe integer. IDs follow the [data model](data-model.md). `actor`, when present, has exactly `kind` (`human`, `agent` or `system`) and a nonempty `name`. It is attribution, not a permission credential.

`operations` contains 1 through 10,000 ordered operations. The entire input is limited to 8 MiB. Unknown envelope, scope, operation and patch fields are rejected. No raw-document replacement, generic JSON merge, renderer state or free-form instruction is an operation.

## Operations

| Type | Required payload besides `type` | Effect and validation |
| --- | --- | --- |
| `addNode` | `node` | Normalize a new node; its ID must be absent and title valid. |
| `updateNode` | `nodeId`, `patch` | Existing node; nonempty patch may contain `title`, `cardContent`, `notes`, `meta`. |
| `removeNode` | `nodeId`, `edgePolicy` | Existing node; policy must equal `removeIncidentEdges`; remove every incoming/outgoing edge, including self-loops. Requires deletes allowed. |
| `addEdge` | `edge` | New edge ID; endpoints must exist at this step. Cycles and parallel edges are permitted. |
| `updateEdge` | `edgeId`, `patch` | Existing edge; nonempty patch may contain `source`, `target`, `kind`, `order`, `meta`. New endpoints must exist at this step. |
| `removeEdge` | `edgeId` | Existing edge; requires deletes allowed. |
| `setEntryNode` | `nodeId` | Null or an existing node ID; sets the default presentation entry. Requires document scope. |
| `reorderEdges` | `source`, `kind`, `edgeIds` | Existing source; list each current outgoing edge of that source/kind exactly once; assign consecutive orders starting at zero. |
| `updateDocument` | `patch` | Nonempty patch with `title` only; requires document scope. Graph `semanticType` is fixed at creation and cannot be patched. |

Node/edge fields follow the data model. Patches shallowly replace listed fields; `meta` replaces the whole metadata object rather than merging nested keys. `updateEdge.patch.order` may additionally be null to remove the optional stored order; other fields cannot be cleared with null unless expressly allowed. IDs, schema versions, receipts and content versions cannot be patched.

Existing targets and duplicate IDs are checked against the evolving draft in operation order. Adding a node before connecting it is valid. A node removed and re-added with the same ID in one batch remains subject to delete checks and all intermediate effects. A later operation cannot refer to an already removed object unless it has been re-added. Final graph invariants are checked after the batch; removing the entry node requires a `setEntryNode` replacement or null in that batch.

## Explicit write scope

Two exact scope shapes are supported:

```json
{"mode":"document","allowDelete":false}
```

```json
{"mode":"ids","nodeIds":["a","b"],"edgeIds":["ab"],"allowDelete":false}
```

All fields in the chosen shape are required, arrays contain unique valid IDs, and empty arrays permit no changes of that category. Document scope allows all graph/document targets but still honors `allowDelete`. ID scope does not allow `updateDocument` or `setEntryNode`. New node and edge IDs must be enumerated in an ID-scoped batch. No additional “allowed traversal root” or implicit browser scope exists.

Validate the union of effects at **every step**, including:

- Nodes added, edited or removed.
- Edges added, edited, reordered or removed, including edges removed indirectly with a node.
- Both old and new endpoints of changed edges, and endpoints of every indirectly removed edge.
- Document fields changed by entry or metadata operations.

Every affected node/edge ID must be allowed. A patch cannot bypass scope by moving an edge to an unlisted node. Delete permission applies even if the same ID is later re-added. Reading more context does not widen write scope. Scope checks use authoritative records, never caller-reported affected IDs.

## Preview

Preview uses a single snapshot, compares its version, validates scope and operations, and returns:

- `operationId`, `baseGraphVersion`, prospective `nextGraphVersion`, and `operationCount`.
- Sorted `affectedNodeIds` and `affectedEdgeIds`, including indirect effects.
- `diff.nodes` and `diff.edges`: ID-sorted arrays of `{id, before, after}` records; absent records use null.
- `diff.document`: `{before, after}` for `{title, semanticType, entryNodeId}` only when those fields change; otherwise null.
- `summary`: `{operationCount, nodeCount, edgeCount}` using affected counts, not just visible diff counts.

Diffs show normalized final before/after content. The affected lists additionally include intermediate changes that cancel out. Receipts and generated timestamps are not prospective semantic diff entries. Preview does not append a receipt or acquire a commit lock. It applies version checking even if its operation ID was previously committed; use `inspect --operation-id` or retry apply to resolve a receipt.

## Apply and idempotency

Apply returns `data.receipt` as defined by the data model and `data.replayed` (boolean). The result envelope's `graphVersion` is the version observed during that commit transaction; a replay's receipt may name an earlier committed version.

Fingerprint the exact UTF-8 input bytes using SHA-256, including whitespace and trailing newline. Reusing an operation ID with exactly those bytes returns the existing receipt without executing the batch, even after later commits. Reusing it with any different bytes returns `OPERATION_ID_REUSE`. Do not normalize or regenerate input when retrying an uncertain result.

Receipt lookup occurs after validating input shape and document identity, but before comparing the base version or checking effects against the current graph. This allows exact retry of operations whose targets were subsequently removed. New operations validate against the current locked snapshot. Every successful new batch increments the version once and publishes its receipt with the graph.

Transaction timing, crash handling and limits are normative in [persistence](persistence-and-concurrency.md). A preview cannot substitute for commit-time validation.

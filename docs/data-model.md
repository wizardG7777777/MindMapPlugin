# Data Model

Status: target persisted document schema version 2. [Operations](operation-schema.md) mutate graph facts; [persistence](persistence-and-concurrency.md) owns commit receipts.

## Canonical document

```json
{
  "JSON-SchemaVersion": 2,
  "metadata": {
    "id": "plan",
    "title": "Product plan",
    "graphVersion": 0,
    "createdAt": "2026-09-05T00:00:00.000Z",
    "updatedAt": "2026-09-05T00:00:00.000Z"
  },
  "graph": {
    "topology": "directed",
    "semanticType": "general",
    "entryNodeId": null,
    "nodes": {},
    "edges": {}
  },
  "commits": []
}
```

All shown fields are required. Unknown fields at the document, metadata, graph, node, edge and receipt levels are rejected. `meta` objects explicitly allow arbitrary JSON semantic attributes. JSON must be UTF-8, contain no duplicate object keys, and use finite numbers; numeric version/order fields must be safe integers.

## Identity and text

Document, node, edge and operation IDs match `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. IDs are case-sensitive. Titles accept Unicode, must have non-whitespace content, and are trimmed at creation or update. Other text fields are preserved verbatim. Timestamp fields use UTC ISO 8601 with milliseconds, as in the example.

`metadata.id` is immutable. File location is passed to commands and is not stored in graph content. Two files can contain the same document ID after copying; concurrency is coordinated by physical target path, not by document ID alone.

`metadata.graphVersion` starts at 0 and increments once per accepted nonempty operation batch, including a batch whose resulting semantic fields happen to be unchanged. Reads, previews and replay of an already committed operation ID never increment it. Creation sets both timestamps equally. A new commit updates `updatedAt`; it never changes `createdAt`.

## Nodes and edges

A normalized node has required `id` and `title`; `cardContent`, `notes` and `meta` default to `""`, `""` and `{}` respectively and are always written in normalized documents.

```json
{"id":"a","title":"Research","cardContent":"Collect evidence","notes":"","meta":{}}
```

A normalized edge has required `id`, `source`, `target`, `kind`; `meta` defaults to `{}` and is always written. Optional `order` is a nonnegative safe integer.

```json
{"id":"ab","source":"a","target":"b","kind":"informs","order":0,"meta":{}}
```

Map keys must equal record IDs. Every endpoint must exist. Edge kinds are nonempty trimmed strings; their spelling does not impose structural restrictions. Multiple edges between the same endpoints are distinguished by ID. Self-loops, directed cycles, multiple incoming edges and disconnected components are valid.

## Topology, meaning and entry

`topology` is `directed` in this contract. `semanticType` is a nonempty trimmed string, default `general`; values such as `mindmap`, `flowchart` or `dependency` describe meaning and do not change validation or supported commands. Tree/DAG constraint profiles and other direction modes are deferred.

`entryNodeId` is null or an existing node ID. It is an optional default presentation starting point, not a tree root, access boundary or implicit selector. An empty graph is valid only with a null entry. A nonempty graph may also have a null entry. Queries require their documented explicit selectors and never rely on a global current node.

Positions, dimensions, colors, layouts, viewport, selected IDs and traversal state do not belong in canonical node/edge records. Semantic `meta` is not a channel for renderer-specific state. Display contracts are deferred separately.

## Commit receipts

`commits` is persistence provenance, not graph content for traversal. It contains one receipt per accepted batch, in ascending `committedGraphVersion` order from 1 through `metadata.graphVersion`. Consequently `commits.length === metadata.graphVersion` in this schema. Operation IDs are unique across the document's entire receipt list.

Each receipt contains `operationId`, `requestHash` (64 lowercase hexadecimal SHA-256 characters), `baseGraphVersion`, `committedGraphVersion`, `committedAt`, optional `actor`, sorted unique `affectedNodeIds`, sorted unique `affectedEdgeIds`, and `summary` (operation, node and edge counts). The first receipt has base version 0; each later base version equals its predecessor's committed version. `updatedAt` equals the last receipt's `committedAt` when a receipt exists. Affected IDs may refer to removed records.

Receipt creation and graph changes are published in the same file replacement. Receipts are not editable by graph operations and are not silently pruned. Exact retries can therefore be resolved even after later commits. Document-size limits include receipts; exhausting the limit causes a visible failure before publication.

## Schema and resource limits

Persisted schema version, CLI contract version, executable release version and graph content version are independent. An unsupported persisted schema returns `UNSUPPORTED_SCHEMA` without modifying the file. Complete machine-readable schemas are exposed through `mindmap schema`; field definitions above are normative until those schemas are implemented and checked.

The first-delivery hard limits are a 64 MiB document and an 8 MiB operation input, measured as UTF-8 bytes. IDs and graph counters must fit their defined bounds. Traversal also has independent output limits defined in [context management](context-management.md). Limits are reported by `capabilities`; a release may not silently lower them.

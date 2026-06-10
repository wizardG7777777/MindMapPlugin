# Operation Schema

## Purpose

This document defines the shared mutation contract used by user-driven and agent-driven editing flows.

Canonical graph changes should be expressed as typed `GraphOperation` records. Presentation-only changes should use separate view-state operations and should not be treated as canonical graph mutations.

The operation layer is closely coupled to the canonical graph schema, but it is not the storage schema itself.

## Design Goals

- Deterministic application
- Explicit graph mutation intent
- Clear validation boundaries
- Easy preview and diff generation
- Safe agent output handling

## Operation Envelope

Every mutation request should be wrapped in an envelope.

```json
{
  "documentId": "doc_001",
  "baseGraphVersion": 7,
  "operations": [
    {
      "type": "addEdge",
      "edge": {
        "id": "edge_topic_market",
        "source": "topic",
        "target": "market",
        "kind": "contains",
        "order": 0,
        "meta": {}
      }
    }
  ]
}
```

`baseGraphVersion` is compared against `metadata.graphVersion` in the canonical document. It is about graph-content concurrency, not JSON schema migration. The persisted document's `JSON-SchemaVersion` is a separate data-structure version and should not be used to decide whether an edit batch is stale.

## Base Record

Every operation should contain:

- `type`
- target identifiers required by that operation
- only the fields needed for that mutation

Operations should not contain:

- derived view state
- prompt text
- arbitrary free-form instructions
- file paths
- ReactFlow component state
- Codex app configuration

## Core v1 Graph Operations

### `addNode`

Purpose:

- Create a new canonical graph node

Shape:

```json
{
  "type": "addNode",
  "node": {
    "id": "pricing",
    "title": "Pricing",
    "cardContent": "Pricing strategy and packaging options.",
    "notes": "",
    "meta": {}
  }
}
```

Validation:

- `node.id` does not already exist
- `node.title` is non-empty after normalization
- `node.cardContent` and `node.notes` are semantic text fields and may be empty strings

### `updateNode`

Purpose:

- Update canonical node fields

Shape:

```json
{
  "type": "updateNode",
  "nodeId": "pricing",
  "patch": {
    "title": "Pricing Strategy",
    "cardContent": "Pricing tiers, packaging, discounts, and monetization assumptions.",
    "meta": {
      "tags": ["priority"]
    }
  }
}
```

Validation:

- `nodeId` exists
- patched fields conform to node schema

### `removeNode`

Purpose:

- Remove a node from the canonical graph

Shape:

```json
{
  "type": "removeNode",
  "nodeId": "pricing",
  "edgePolicy": "removeIncidentEdges"
}
```

Validation:

- `nodeId` exists
- `nodeId` is not `entryNodeId` unless the same batch sets a valid replacement entry node
- incident edge handling is explicit

### `addEdge`

Purpose:

- Create a new directed relationship between two existing nodes

Shape:

```json
{
  "type": "addEdge",
  "edge": {
    "id": "edge_pricing_market",
    "source": "pricing",
    "target": "market",
    "kind": "references",
    "meta": {}
  }
}
```

Validation:

- `edge.id` does not already exist
- `edge.source` exists
- `edge.target` exists
- directed cycles are allowed unless rejected by a specific edge kind rule

### `updateEdge`

Purpose:

- Update canonical edge fields

Shape:

```json
{
  "type": "updateEdge",
  "edgeId": "edge_pricing_market",
  "patch": {
    "kind": "contains",
    "order": 2
  }
}
```

Validation:

- `edgeId` exists
- patched fields conform to edge schema
- source and target updates, if allowed, continue to reference existing nodes

### `removeEdge`

Purpose:

- Remove one directed relationship

Shape:

```json
{
  "type": "removeEdge",
  "edgeId": "edge_pricing_market"
}
```

Validation:

- `edgeId` exists

### `setEntryNode`

Purpose:

- Change the default starting node used by views and agent context

Shape:

```json
{
  "type": "setEntryNode",
  "nodeId": "market"
}
```

Validation:

- `nodeId` exists

### `reorderEdges`

Purpose:

- Set stable ordering for outgoing edges of one source node and relation kind

Shape:

```json
{
  "type": "reorderEdges",
  "source": "topic",
  "kind": "contains",
  "edgeIds": ["edge_topic_market", "edge_topic_product"]
}
```

Validation:

- `source` exists
- each edge id exists
- each listed edge has the same `source` and `kind`
- the list contains exactly the edges being reordered for that source and kind

## Separate View-State Operations

Presentation edits should be modeled outside canonical `GraphOperation` records.

Examples:

- `setNodePosition`
- `toggleCollapse`
- `setViewport`
- `setSelection`

These operations may still be useful, but they belong to a view-state contract rather than the canonical graph operation contract.

## Batching Rules

Operations should be applied as one atomic batch.

Rules:

- Validate the entire batch before commit
- Reject the whole batch if one operation fails
- Preserve operation order inside the batch
- Validate the final graph after applying the batch in memory

This is especially important for agent-generated operation lists.

## Scope Restrictions for Agent Batches

Agent-originated batches should support explicit scope limits.

Examples:

- allowed node ids
- allowed edge ids
- allowed traversal root
- allowed edge kinds
- forbidden node ids
- disallow delete operations

These constraints should be checked by the Graph Edit Orchestrator before commit.

## Non-Goals for v1

Do not add these yet:

- generic free-form patch operations
- raw Mermaid replacement
- direct JSON merge operations
- cross-document operations
- collaborative conflict merging
- ReactFlow state mutations inside canonical graph operations

## Practical Rule

If an edit cannot be described as a small typed operation, it is probably too unbounded for v1.

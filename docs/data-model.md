# Data Model

## Purpose

The canonical data model stores graph facts only.

It should not store:

- File paths
- Workspace storage policy
- Codex app or plugin configuration
- ReactFlow component state
- Canvas viewport state
- Selection state
- Extracted subtree projections
- Traversal-local state such as `hasVisited`

If presentation state is needed, it should live in a separate view-state structure owned by the rendering or persistence layer.

## Canonical Document Shape

The persisted graph document should support directed graphs from the start. Cycles are allowed at the canonical graph level.

```json
{
  "JSON-SchemaVersion": 1,
  "metadata": {
    "id": "doc_001",
    "title": "Untitled Mind Map",
    "graphVersion": 7,
    "createdAt": "2026-04-22T00:00:00.000Z",
    "updatedAt": "2026-04-22T00:00:00.000Z"
  },
  "document": {},
  "graph": {
    "diagramKind": "mindmap",
    "entryNodeId": "topic",
    "nodes": {
      "topic": {
        "id": "topic",
        "title": "Main Topic",
        "cardContent": "High-level planning topic for the map.",
        "notes": "",
        "meta": {
          "tags": [],
          "status": null
        }
      },
      "market": {
        "id": "market",
        "title": "Market",
        "cardContent": "Market size, segments, competitors, and demand signals.",
        "notes": "Long-form research notes can live here without becoming the primary node label.",
        "meta": {
          "tags": ["priority"],
          "status": "active"
        }
      },
      "research": {
        "id": "research",
        "title": "Research",
        "cardContent": "Evidence, sources, and validation work.",
        "notes": "",
        "meta": {
          "tags": [],
          "status": null
        }
      }
    },
    "edges": {
      "edge_topic_market": {
        "id": "edge_topic_market",
        "source": "topic",
        "target": "market",
        "kind": "contains",
        "order": 0,
        "meta": {}
      },
      "edge_market_research": {
        "id": "edge_market_research",
        "source": "market",
        "target": "research",
        "kind": "contains",
        "order": 0,
        "meta": {}
      },
      "edge_research_market": {
        "id": "edge_research_market",
        "source": "research",
        "target": "market",
        "kind": "references",
        "meta": {}
      }
    }
  }
}
```

## Field Intent

### `JSON-SchemaVersion`

Data-structure version for the persisted JSON shape.

- Describes which canonical data schema this file follows
- Used for future migrations of the stored JSON format
- Does not describe graph content changes
- Should not be used for edit concurrency checks

### `metadata`

Metadata-only document information.

- Human-facing title
- Stable document identifier
- `graphVersion` for graph-content revision checks
- Timestamps

### `document`

Reserved document-level extension object.

- Empty in v1
- Available for future non-metadata document fields
- Must not contain renderer-specific state, file paths, or plugin configuration

### `graph`

Semantic graph structure only.

- `diagramKind` identifies the intended graph expression, such as `mindmap`, `fishbone`, `flowchart`, `concept-map`, or `dependency-graph`
- `entryNodeId` identifies the default starting point for map views and agent context
- `nodes` stores normalized node records
- `edges` stores directed relationships between nodes
- `kind` describes edge semantics such as `contains`, `references`, or future custom relation types
- `order` is optional and only meaningful for relation kinds that require stable sibling-like ordering
- `meta` carries semantic attributes that may matter to agents

`diagramKind` belongs in canonical graph data because it changes how the graph should be understood. It may affect default layout strategy, Mermaid projection style, agent interpretation, available tools, and relation constraints.

It should not contain renderer-specific implementation details such as ReactFlow node types, component names, spacing values, colors, handles, or edge renderer variants.

### Node content fields

Node text content is split by visibility, capacity, and semantic importance.

- `title` is the primary node label. It should be short, human-scannable, and suitable for map nodes, Mermaid labels, search results, and agent references.
- `cardContent` is the visible card-level content. It can hold a concise explanation, summary, or supporting text that may appear inside an expanded node card.
- `notes` is the long-form note body. It can hold detailed notes, source material, drafts, or extended reasoning that should not dominate the visual map.

The intended relationship is:

```text
title       -> shortest, highest importance, default visual and Mermaid label
cardContent -> medium length, medium importance, visible card detail
notes       -> longest, lowest priority for default display, useful for deep agent context
```

Mermaid projections should use `title` as the default node label. They may include `cardContent` or summarized `notes` only when a tool or context request explicitly asks for richer node context.

## Separate View State

Presentation data should not be part of the canonical graph document. Positions, measured dimensions, collapsed state, viewport, and selection belong to a separate view-state structure owned by the Layout Rendering Engine and Persistence Layer.

The view-state contract is documented separately in `docs/view-state.md`.

## Theme and Template Configuration

Theme and template configuration maps graph semantics to visual rendering behavior. It is not canonical graph data and should not be embedded in `graph`.

The canonical graph may store semantic fields such as `diagramKind`, node metadata, and edge `kind`. Theme and template configuration decides how those semantics are rendered, including layout mode, shapes, spacing, typography, colors, markers, and handles.

The theme and template contract is documented separately in `docs/theme-template.md`.

## Why Normalized Nodes and Edges

A normalized node and edge map is preferable to recursive nesting because it can represent both tree-like mind maps and directed cyclic graphs.

It also makes these operations easier:

- Moving relationship edges
- Adding non-tree references
- Preserving node identity
- Validating edge endpoints
- Extracting focused traversal projections
- Generating agent-readable context

Nested or tree-shaped export can still be produced when needed, but should be treated as a projection.

## Invariants

Graph Core should enforce these invariants:

1. `entryNodeId` exists in `graph.nodes`
2. `diagramKind` is present and belongs to a known or registered graph expression type
3. Every node id is unique
4. Every edge id is unique
5. Every edge `source` exists in `graph.nodes`
6. Every edge `target` exists in `graph.nodes`
7. Directed cycles are allowed unless a specific tool or projection requests acyclic output
8. `order` values are only interpreted within the same source node and relation kind
9. Every node `title` is non-empty after normalization
10. `cardContent` and `notes` may be empty strings, but must remain semantic text fields rather than renderer state
11. View-state records must never be required to validate canonical graph data

## Traversal and Subtree Extraction

Subtrees are runtime projections, not persisted document state.

Tools such as `extract_subtree` should compute traversal output from the canonical directed graph when needed. If traversal encounters a cycle, the tool should use runtime state such as a visited set and return an acyclic projection with explicit cycle or reference markers.

The canonical graph may contain cycles. The extracted representation used for agent context does not have to.

## Edit Operations

Graph mutations should be expressed by typed operations defined outside this document.

This data model only defines what the stored graph is. Operation contracts live in `docs/operation-schema.md`, and tool-level contracts live in `docs/tooling-contract.md`.

## Future Extensions

Planned but not required for v1:

- Typed relation schemas
- Multi-document graph references
- Revision history
- Multiple view-state documents per graph

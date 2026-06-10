# MindMap Plugin — Codex-Driven Structured Knowledge System

A plugin that lets LLM agents read, reason about, and edit mind maps through structured tools—without direct access to raw graph data.

**Core design principle:** one canonical JSON graph, two projections. The LLM sees a compact Mermaid structural view. The human sees an interactive ReactFlow editor. Both operate on the same underlying graph through explicit, validated operations.

---

## Architecture at a Glance

```text
+------------------+     +---------------------+     +------------------+
|   Codex Host     |     |   ReactFlow WebUI   |     |  Persistence     |
| (LLM Agent)      |     |   (Human Editor)    |     |  (JSON files)    |
+--------+---------+     +----------+----------+     +--------+---------+
         |                          |                          |
         v                          v                          v
+--------+---------+     +----------+----------+     +--------+---------+
|  MCP stdio       |     |  Layout Rendering   |     |  Graph Core      |
|  server          |     |  Engine             |     |  (validation &   |
|  (11 tools)      |     |  (view-model +      |     |   operations)    |
+--------+---------+     |   layout)           |     +--------+---------+
         |               +----------+----------+              |
         v                          |                          v
+--------+---------+               |               +----------+----------+
|  Tool Registry   |<--------------+-------------->|  Graph Edit         |
|  + Agent Contract|                               |  Orchestrator       |
+------------------+                               |  (preview/apply/    |
         |                                         |   scope checks)     |
         v                                         +----------+----------+
+--------+---------+                                          |
| Context Mgmt     |<-----------------------------------------+
| (subtree extract,|
|  Mermaid compile,|
|  memory)         |
+------------------+
```

**Key architectural decisions:**

| Decision | Rationale |
|---|---|
| **Normalized nodes + edges** (not nested trees) | Supports both tree-like mind maps and directed cyclic graphs; makes edge rewrites and non-tree references trivial |
| **Graph editing ≠ Visual editing** | Semantic structure and UI state are fully separated—agent behavior stays deterministic regardless of how the user drags nodes |
| **Mermaid is generated, never stored** | Guarantees the LLM always sees a view derived from canonical truth; no risk of stale or hand-edited Mermaid diverging from the graph |
| **Operations are validated before application** | Every agent edit is previewed, version-checked, and scope-restricted before touching canonical data |
| **MCP-native tool interface** | Agents interact through 11 structured tools with JSON schemas—not through raw prompt text or unstructured rewrites |

---

## What the Agent Can Do

The plugin exposes **11 MCP tools** to Codex (or any MCP-compatible host):

| Tool | Purpose |
|---|---|
| `mindmap_get_document_summary` | Read metadata and compact graph statistics |
| `mindmap_get_node` / `mindmap_get_neighbors` | Read individual nodes and their relationships |
| `mindmap_extract_subtree` | Pull a focused, acyclic projection with cycle/repeated-node markers |
| `mindmap_compile_mermaid_context` | Convert a graph or subtree into deterministic Mermaid + projection metadata |
| `mindmap_preview_operations` | Validate an edit envelope without writing anything |
| `mindmap_apply_operations` | Apply a validated edit envelope and bump `graphVersion` |
| `mindmap_render_reactflow_view` | Project canonical data into ReactFlow-compatible nodes and edges |
| `mindmap_get_current_selection` | Read what the human has selected in the WebUI |
| `mindmap_build_context_from_selection` | Build an agent context packet from the current WebUI selection |
| `mindmap_validate_document` | Check canonical invariants |

All tools operate through a **strict schema envelope** that carries `documentId`, `baseGraphVersion`, actor metadata, and optional scope restrictions. Stale versions, out-of-scope edits, and destructive operations without confirmation are rejected at the orchestrator layer.

---

## The Canonical Data Model

Graph facts live in a single JSON document. Everything else—Mermaid output, ReactFlow view state, selection state—is a **runtime projection**.

```json
{
  "JSON-SchemaVersion": 1,
  "metadata": {
    "id": "doc_001",
    "title": "Market Research",
    "graphVersion": 7
  },
  "graph": {
    "diagramKind": "mindmap",
    "entryNodeId": "topic",
    "nodes": { "topic": { "id": "topic", "title": "Main Topic", ... } },
    "edges": { "edge_topic_market": { "id": "edge_topic_market", "source": "topic", "target": "market", "kind": "contains" } }
  }
}
```

**Invariants enforced by Graph Core:**
- `entryNodeId` must exist in `nodes`
- Every edge `source` and `target` must reference existing nodes
- Node IDs and edge IDs are unique
- Directed cycles are allowed at the graph level; projections mark them explicitly
- View-state records are never required to validate canonical data

---

## Projections: From One Graph to Many Views

### Subtree Extraction

`extract_subtree` traverses the directed graph from a start node, up to a configurable depth, and produces an acyclic projection. Cycles and repeated nodes are marked—not pruned—so the agent knows the full structure exists even when the projection is bounded.

### Mermaid Compilation

The Mermaid compiler transforms a projection into a deterministic, LLM-readable flowchart. It handles:
- Identifier sanitization and label escaping
- Deterministic node/edge ordering (same graph → same Mermaid text every time)
- Optional edge-kind labeling and node-content inclusion (`title` only, `cardContent`, or full `notes`)
- Projection-support metadata so the agent can map Mermaid references back to canonical IDs

### ReactFlow Rendering

The layout engine projects canonical graph data into ReactFlow view models. Node positions, viewport, and collapsed state are stored in a **separate view-state file** (`.mindmap/view-state/`)—never inside the canonical document.

---

## Safety & Editing Model

All edits pass through the **Graph Edit Orchestrator**:

1. **Actor-aware policies:** user edits may apply immediately for low-risk ops; agent edits default to preview-before-apply
2. **Version checks:** every edit envelope carries a `baseGraphVersion`; stale envelopes are rejected
3. **Scope restrictions:** edits can be restricted to allowed node IDs, edge kinds, or forbidden node sets
4. **Atomic batches:** an operation envelope either applies completely or fails without partial mutation
5. **Preview mode:** agents can preview the exact affected nodes and edges before committing

---

## Quick Start

### CLI (Python standard library)

```bash
PYTHONPATH=src python3 -m mindmap_plugin.cli validate-document \
  --document samples/documents/sample-mindmap.json

PYTHONPATH=src python3 -m mindmap_plugin.cli compile-mermaid-context \
  --document samples/documents/sample-mindmap.json --start-node-id market

PYTHONPATH=src python3 -m mindmap_plugin.cli preview-operations \
  --document samples/documents/sample-mindmap.json \
  --operations samples/operations/add-pricing.json
```

### WebUI (ReactFlow sidecar)

```bash
cd webui && npm install && npm run build
PYTHONPATH=src python3 -m mindmap_plugin.webui \
  --document samples/documents/sample-mindmap.json
```

### Tests

```bash
PYTHONPATH=src python3 -m pytest tests/
```

---

## Project Structure

```
.
├── src/mindmap_plugin/
│   ├── graph_core.py       # Canonical schema, validation, CRUD operations
│   ├── projections.py      # Subtree extraction, full projection, selection projection
│   ├── mermaid.py          # Deterministic JSON → Mermaid compiler
│   ├── layout.py           # ReactFlow view-model generation
│   ├── tools.py            # 11 internal tool implementations
│   ├── mcp_server.py       # MCP stdio server (JSON-RPC 2.0)
│   ├── cli.py              # Python CLI entrypoint
│   ├── webui.py            # ReactFlow sidecar server
│   ├── io.py               # JSON read/write utilities
│   └── errors.py           # Structured error hierarchy
├── webui/                  # React + ReactFlow frontend
├── tests/                  # Unit tests (pytest)
├── samples/                # Example documents and operations
├── docs/                   # 12 architecture & design documents
└── .codex-plugin/          # Codex plugin metadata
```

---

## Design Documents

- [`docs/architecture.md`](docs/architecture.md) — Module boundaries, interaction flow, design rules
- [`docs/data-model.md`](docs/data-model.md) — Canonical document schema, invariants, field semantics
- [`docs/editing-architecture.md`](docs/editing-architecture.md) — Edit orchestrator, actor policies, transaction boundaries
- [`docs/tooling-contract.md`](docs/tooling-contract.md) — Tool schemas, routing, permissions
- [`docs/context-management.md`](docs/context-management.md) — Context assembly, budgeting, injection payloads
- [`docs/agent-mermaid-contract.md`](docs/agent-mermaid-contract.md) — Mermaid projection semantics for agents
- Plus: view-state, theme-template, operation-schema, implementation-roadmap, cli-reference, codex-plugin-setup

---

## Tech Stack

- **Runtime:** Python 3.11+ (standard library + `pytest` for tests)
- **Frontend:** React, TypeScript, ReactFlow
- **Protocol:** MCP (Model Context Protocol) over stdio, JSON-RPC 2.0
- **Layout:** Custom tree + layered layout adapters (ReactFlow-compatible)

---

## License

MIT

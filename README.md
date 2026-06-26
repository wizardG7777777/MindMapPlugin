# MindMap Plugin - Codex-Driven Structured Knowledge System

A TypeScript plugin that lets LLM agents read, reason about, and edit mind maps through structured tools without direct access to raw graph data.

**Core design principle:** one canonical JSON graph, two projections. The LLM sees a compact Mermaid structural view. The human sees an interactive ReactFlow editor. Both operate on the same underlying graph through explicit, validated operations.

---

## Architecture At A Glance

```text
+------------------+     +---------------------+     +------------------+
|   Codex Host     |     |   ReactFlow WebUI   |     |  Persistence     |
|   (LLM Agent)    |     |   (Human Editor)    |     |  (JSON files)    |
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
| **Normalized nodes + edges** | Supports tree-like mind maps and directed cyclic graphs; makes edge rewrites and non-tree references straightforward |
| **Graph editing is separate from visual editing** | Semantic structure and UI state stay separate, so agent behavior remains deterministic regardless of node placement |
| **Mermaid is generated, never stored** | The LLM always sees a view derived from canonical truth |
| **Operations are validated before application** | Every agent edit is previewed, version-checked, and scope-restricted before touching canonical data |
| **MCP-native tool interface** | Agents interact through structured tools with JSON schemas |

Further design details live in:

- `docs/architecture.md`
- `docs/editing-architecture.md`
- `docs/data-model.md`
- `docs/view-state.md`
- `docs/theme-template.md`
- `docs/context-management.md`
- `docs/operation-schema.md`
- `docs/tooling-contract.md`
- `docs/agent-mermaid-contract.md`
- `docs/implementation-roadmap.md`
- `docs/cli-reference.md`
- `docs/codex-plugin-setup.md`

---

## Runtime

The plugin runtime is implemented entirely in TypeScript. It covers:

- Canonical graph validation and typed graph operations
- Focused subtree, full-graph, and selection projections
- Deterministic Mermaid context generation with `projectionSupport`
- ReactFlow-compatible view-model projection
- Local WebUI service and launcher with runtime health checks
- MCP stdio server declared by `.mcp.json`
- CLI access to query, preview, and mutation tools

Run CLI commands from `webui/`:

```bash
npm run cli -- validate-document --document ../samples/documents/sample-mindmap.json
npm run cli -- compile-mermaid-context --document ../samples/documents/sample-mindmap.json --start-node-id market
npm run cli -- preview-operations --document ../samples/documents/sample-mindmap.json --operations ../samples/operations/add-pricing.json
```

Run the TypeScript MCP server from `webui/`:

```bash
npm run mcp
```

---

## WebUI

The WebUI is a local ReactFlow projection for human inspection and direct text editing. It does not call Codex. Node title and card text edits are persisted to canonical graph JSON through the same `GraphOperation` validation path used by tools. Display-only view state, such as node positions and viewport, is stored under `.mindmap/view-state/`; that file is not graph truth.

Build the frontend once:

```bash
cd webui
npm install
npm run build
```

Start the localhost sidecar from `webui/`:

```bash
npm run webui -- --document ../samples/documents/sample-mindmap.json
```

The command prints a `http://127.0.0.1:<port>/` URL and writes runtime metadata to `.mindmap/runtime/webui.json`. The sidecar only binds to localhost and exposes `GET /api/health`, `GET /api/graph`, `POST /api/operations`, `GET/POST /api/selection`, and `GET/POST /api/view-state` without a browser token. Selection state is session-only.

Codex can read the running WebUI selection through MCP tools:

- `mindmap_get_current_selection`
- `mindmap_build_context_from_selection`

These tools use `.mindmap/runtime/webui.json` by default to locate the sidecar, then build context from canonical JSON plus the selected node ids.

---

## What The Agent Can Do

The plugin exposes **11 MCP tools** to Codex or any MCP-compatible host:

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

All tools operate through a strict schema envelope that carries `documentId`, `baseGraphVersion`, actor metadata, and optional scope restrictions. Stale versions, out-of-scope edits, and destructive operations without confirmation are rejected at the orchestrator layer.

---

## Canonical Data Model

Graph facts live in a single JSON document. Everything else, including Mermaid output, ReactFlow view state, and selection state, is a runtime projection.

```json
{
  "JSON-SchemaVersion": 1,
  "metadata": {
    "id": "doc_001",
    "title": "Market Research",
    "graphVersion": 9
  },
  "graph": {
    "diagramKind": "mindmap",
    "entryNodeId": "topic",
    "nodes": {
      "topic": {
        "id": "topic",
        "title": "Main Topic"
      }
    },
    "edges": {
      "edge_topic_market": {
        "id": "edge_topic_market",
        "source": "topic",
        "target": "market",
        "kind": "contains"
      }
    }
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

## Quick Start

```bash
cd webui
npm install
npm run build
npm run test:unit
npm run webui -- --document ../samples/documents/sample-mindmap.json
```

Run browser tests after building:

```bash
npm run test:e2e
```

---

## Project Structure

```text
.
├── webui/
│   ├── src/
│   │   ├── core/          # Canonical schema, validation, operations, projections
│   │   ├── mcp/           # MCP stdio server and tool registry
│   │   ├── server/        # Local WebUI sidecar and launcher
│   │   ├── cli.ts         # TypeScript CLI entrypoint
│   │   └── App.tsx        # ReactFlow editor
│   ├── test/              # TypeScript unit and contract tests
│   └── e2e/               # Browser tests
├── samples/               # Example documents and operations
├── docs/                  # Architecture and design documents
└── .codex-plugin/         # Codex plugin metadata
```

---

## Tech Stack

- **Runtime:** TypeScript, Node.js
- **Frontend:** React, ReactFlow
- **Protocol:** MCP over stdio, JSON-RPC 2.0
- **Layout:** Custom tree + layered layout adapters
- **Tests:** Node test runner and Playwright

---

## License

MIT

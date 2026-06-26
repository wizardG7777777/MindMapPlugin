# Tooling Contract

## Purpose

This document defines the tool surface that lets agents inspect, reason about, preview, and modify mind map documents.

The tool system should give the model enough graph context to make precise edits while keeping canonical mutation authority inside Graph Core and the Graph Edit Orchestrator.

## Tool System Goals

The tool system exists to help agents operate on and construct mind map documents through bounded, inspectable actions.

Primary goals:

- Help agents understand the current graph structure without reading raw JSON directly
- Help agents construct new mind map content from user-provided text or instructions
- Help agents expand, reorganize, summarize, and refine focused parts of a graph
- Provide scoped graph context through node queries, neighborhood queries, extracted projections, and Mermaid context
- Require structured edit proposals instead of free-form full-document rewrites
- Support preview-before-apply workflows for risky or structural edits
- Keep all canonical mutations routed through the Graph Edit Orchestrator and Graph Core validation

The tool system should optimize for precise graph operation, not for general-purpose file editing or canvas manipulation.

## V1 Capability Scope

The first version should provide a small but complete loop for agent-assisted mind map construction and editing.

V1 should include:

- Read document metadata and a compact graph summary
- Read a node by id
- Read immediate neighbors for a node
- Extract a focused, acyclic subtree or local projection
- Compile a graph or projection into Mermaid context
- Generate structured graph operations from a bounded user instruction
- Preview a batch of graph operations before applying it
- Apply a validated batch of graph operations
- Return affected nodes, affected edges, and a concise change summary

V1 should not include:

- Whole-document LLM rewrites
- Free-form ReactFlow canvas manipulation
- Full Mermaid import as canonical graph reconstruction
- Automatic large-scale restructuring without preview
- Collaboration, remote sync, or multi-user conflict resolution
- Advanced visual style editing beyond semantic graph fields and existing templates

This scope is intentionally narrow: the first version should prove that an agent can inspect a graph, propose structured edits, preview the result, and apply a valid mutation safely.

## Two Tool Layers

The project uses the word "tool" in two related but different ways. These layers must stay separate.

### Internal Plugin Tools

Internal plugin tools are capabilities implemented inside the Mind Map plugin. They are defined by the Tool Registry and are independent from Codex host APIs.

An internal tool definition should include:

- Stable tool name and version
- Tool category, such as query, preview, or mutation
- Input schema
- Output schema
- Permission and confirmation requirements
- Routing target inside the plugin
- Mutation behavior
- Error and ambiguity behavior

Internal tools execute plugin-specific work:

- Reading graph facts
- Extracting scoped projections
- Building focused context
- Requesting Mermaid compilation
- Previewing structured edits
- Applying validated edits through the Graph Edit Orchestrator

Internal tools must not become:

- Raw JSON rewrite endpoints
- ReactFlow component APIs
- Prompt templates
- Codex host API wrappers
- Direct bypasses around Graph Core validation

### External Codex-Facing Tools

External Codex-facing tools are the tools exposed to Codex by the plugin runtime. In this project, the expected exposure mechanism is an MCP server declared by the plugin manifest.

At the plugin boundary:

- `.codex-plugin/plugin.json` declares plugin metadata and points to plugin components such as `mcpServers`
- `.mcp.json` declares the local MCP server command Codex can start
- The MCP server exposes callable tools to Codex
- Each external MCP tool maps to one or more internal plugin tools
- External tool inputs and outputs should use the Agent Contract schemas where agent workflows are involved

External Codex-facing tools are responsible for host interaction concerns:

- Presenting stable callable tool names to Codex
- Accepting serialized tool inputs from Codex
- Returning serialized tool results, previews, errors, or confirmation requests
- Translating Codex-facing calls into Tool Registry calls
- Avoiding leakage of Codex-specific details into Graph Core, Mermaid Compiler, Layout Rendering Engine, or Graph Edit Orchestrator

External Codex-facing tools must not become:

- The canonical source of graph truth
- The internal graph mutation authority
- A storage format
- A rendering pipeline
- A replacement for the internal Tool Registry

## Tool Exposure Flow

```text
Codex Host
  -> plugin manifest
    -> MCP server
      -> external Codex-facing tool
        -> Tool Registry
          -> Context Management System / Mermaid Compiler / Graph Edit Orchestrator / Graph Query
```

The same internal tool may be exposed externally in more than one way later, but the internal contract should remain stable.

## CLI Execution Layer

The project exposes the same internal tools through a local CLI. This is a development and automation entrypoint, not a separate business logic layer.

The CLI is implemented in TypeScript and its observable contract should stay stable:

- Commands map to internal plugin tools
- Inputs are passed as explicit flags or JSON files/stdin
- Outputs are serialized as structured JSON
- Errors use structured error codes and messages
- Mutation commands route through the Graph Edit Orchestrator
- Query commands do not persist derived projections

The CLI can be used in two ways:

- Directly by Codex when guided by documentation during early development
- Indirectly by an MCP server wrapper after plugin packaging exists

Recommended staged flow:

```text
Codex or developer
  -> CLI command
    -> Tool Registry
      -> Context Management System / Mermaid Compiler / Graph Edit Orchestrator / Graph Query
```

Later MCP-backed flow:

```text
Codex Host
  -> MCP server
    -> external Codex-facing tool
      -> CLI command or internal library call
        -> Tool Registry
```

The CLI should not replace MCP as the long-term Codex-facing integration. It should make the internal tool contracts testable before the plugin transport is finalized.

## Design Principles

- Tools should expose graph facts and focused projections, not UI implementation details.
- Read-only tools should be clearly separated from mutation tools.
- Mutation tools should accept typed operations rather than raw document rewrites.
- Tool outputs should be scoped enough for context efficiency but complete enough for reliable reasoning.
- Derived projections such as extracted subtrees must not be persisted as canonical state.
- Internal tool contracts should not depend on Codex-specific transport details.
- External Codex-facing tools should be thin adapters over internal plugin tools.
- CLI commands should be thin adapters over internal plugin tools and should return structured JSON.

## Tool Categories

### Query Tools

Query tools inspect the current document without changing it.

Expected responsibilities:

- Fetch document metadata
- Fetch individual nodes
- Inspect directed node and edge relationships
- Extract focused graph projections
- Produce Mermaid context for agent reasoning

### Preview Tools

Preview tools evaluate proposed edits without committing them.

Expected responsibilities:

- Validate operation batches
- Produce before-and-after summaries
- Produce scoped diffs
- Explain rejected edits

### Mutation Tools

Mutation tools change canonical document state through the Graph Edit Orchestrator.

Expected responsibilities:

- Apply validated operation batches
- Enforce `graphVersion` checks
- Enforce scope and actor permissions
- Return the next `graphVersion` and affected graph scope

## Initial Tool List

This list is intentionally minimal but complete enough for the first inspect-preview-apply loop. It should grow only after the architecture and edit contracts are stable.

### `get_document_summary`

Category:

- Query tool

Purpose:

- Return document metadata, `graphVersion`, node count, edge count, entry node, diagram kind, and compact relation counts.

Mutation behavior:

- Does not mutate canonical JSON

### `get_node`

Category:

- Query tool

Purpose:

- Return one canonical node by id, including `title`, `cardContent`, `notes`, and semantic `meta`.

Mutation behavior:

- Does not mutate canonical JSON

### `get_neighbors`

Category:

- Query tool

Purpose:

- Return incoming and/or outgoing directed relationships around one node.

Mutation behavior:

- Does not mutate canonical JSON

### `extract_subtree`

Category:

- Query tool

Purpose:

- Extract a focused, acyclic projection from the canonical graph for agent reasoning.

Expected inputs:

- `documentId`
- `startNodeId`
- `direction`
- `maxDepth`
- `cyclePolicy`

Expected output:

- A projection starting at `startNodeId`
- Included node ids and labels
- Included edges
- Cycle or repeated-node markers when traversal revisits a node
- Optional metadata needed for Mermaid compilation

Mutation behavior:

- Does not mutate canonical JSON
- Does not persist selected or extracted subtree state

Runtime behavior:

- May use an internal visited set during traversal
- Must convert cyclic source graphs into an acyclic projection
- Must preserve references to canonical node ids even when projection nodes are introduced

Notes:

- The canonical graph may contain directed cycles.
- This tool is responsible for breaking traversal output into an agent-readable acyclic representation.

### `compile_mermaid_context`

Category:

- Query tool

Purpose:

- Convert canonical graph data or extracted graph projections into stable Mermaid text for LLM context injection.

Expected inputs:

- `documentId`
- `projection`
- `orientation`
- `includeEdgeKinds`
- `maxNodes`
- `maxEdges`

Expected output:

- Mermaid text
- Included canonical node ids
- Included canonical edge ids
- Omitted node or edge counts when context limits apply
- Cycle or repeated-node marker summary when present

Mutation behavior:

- Does not mutate canonical JSON
- Does not persist Mermaid output

Runtime behavior:

- Must call the shared Mermaid Compiler mechanism
- Must not implement its own Mermaid formatting rules inside the tool
- Must use Context Management or graph query behavior to resolve traversal scope before calling the compiler when no projection is provided

### `preview_operations`

Category:

- Preview tool

Purpose:

- Validate a typed `GraphOperation` envelope and return affected graph scope without committing it.

Mutation behavior:

- Does not mutate canonical JSON
- Must route through the Graph Edit Orchestrator validation path

### `apply_operations`

Category:

- Mutation tool

Purpose:

- Apply a validated typed `GraphOperation` envelope as one atomic batch.

Mutation behavior:

- Mutates canonical JSON through the Graph Edit Orchestrator and Graph Core
- Must enforce `baseGraphVersion`
- Must return the next `graphVersion`

### `validate_document`

Category:

- Query tool

Purpose:

- Validate canonical graph invariants and return a compact summary when the document is valid.

Mutation behavior:

- Does not mutate canonical JSON

### `render_reactflow_view`

Category:

- Query/projection tool

Purpose:

- Produce ReactFlow-compatible nodes and edges from canonical graph data plus optional separate view state.

Mutation behavior:

- Does not mutate canonical JSON
- Does not persist generated layout or view state

### WebUI `POST /api/operations`

Category:

- Local sidecar mutation endpoint

Purpose:

- Let direct WebUI edits submit typed `GraphOperation` envelopes.
- Keep user text edits on the same validation and versioning path as tool-driven graph edits.

Mutation behavior:

- Mutates canonical graph JSON through Graph Core after validating `documentId`, `baseGraphVersion`, and operation invariants
- Returns the updated ReactFlow projection after a successful write
- Rejects stale or invalid operation envelopes

### WebUI `GET/POST /api/view-state`

Category:

- Local sidecar display-state endpoint

Purpose:

- Persist WebUI-only positions and viewport outside the canonical document.
- Let `GET /api/graph` render with saved presentation state while preserving canonical JSON as the only graph source of truth.

Mutation behavior:

- Writes only `.mindmap/view-state/` display-state JSON
- Does not mutate canonical graph JSON
- Rejects stale `graphVersion`, unknown node ids, and non-display payloads

### `get_current_selection`

Category:

- Query tool

Purpose:

- Read the current session-only WebUI selection from the running local sidecar.
- Return `nodeCount`, `edgeCount`, and a short `promptHint` such as "The user selected 2 nodes in the WebUI."

Mutation behavior:

- Does not mutate canonical JSON
- Does not persist view state

### `build_context_from_selection`

Category:

- Query/context tool

Purpose:

- Build an agent context packet from the current WebUI selection, using canonical JSON for node content and Mermaid context generation.
- Include a short `promptHint` with the selected node count for Codex-facing prompt composition.

Mutation behavior:

- Does not mutate canonical JSON
- Does not trust browser-provided node content

## Future Candidate Tools

These are placeholders for later discussion, not committed tool contracts.

- `explain_validation_error`
- `generate_operations_from_instruction`
- `summarize_branch`
- `find_nodes`

## Open Questions

- Should `extract_subtree` optionally call `compile_mermaid_context` for convenience?
- Should tools return Mermaid text by default, or only when requested?
- How should repeated nodes differ from cycle-cut nodes in the output schema?
- Should mutation tools always require user confirmation in v1?

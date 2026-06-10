# Implementation Roadmap

## Phase 0: Architecture and Contracts

Goal:

- Freeze the system shape before coding

Deliverables:

- Repository docs
- Canonical schema draft
- Mermaid contract draft
- Module boundaries

Exit criteria:

- The team can describe one end-to-end edit flow unambiguously

## Phase 1: Graph Core

Goal:

- Build the canonical model and deterministic mutations

Scope:

- Schema types
- Validation rules
- Basic graph operations
- Minimal serialization format

Deliverables:

- `GraphDocument` type
- Validation layer
- Mutation functions
- Sample fixture documents

Exit criteria:

- A small graph can be created, updated, and validated without any UI

## Phase 2: Mermaid Compiler

Goal:

- Produce reliable LLM-facing graph projections

Scope:

- Full graph compilation
- Subtree compilation
- Stable node ordering
- Escaping strategy
- Stable Mermaid node identifier rules
- Edge semantic labels
- `projectionSupport` output for edit targeting
- Cycle and repeated-node markers
- Parent-child and sibling order projection rules

Deliverables:

- `compileToMermaid(graph, scope)` API
- Test fixtures for deterministic output
- Size-limited projection mode

Exit criteria:

- The same graph always compiles to the same Mermaid text

## Phase 3: Layout Rendering Engine

Goal:

- Render the canonical graph in a usable editor

Scope:

- `JSON -> nodes/edges`
- Position hydration
- Expand/collapse behavior
- Optional auto-layout integration

Deliverables:

- Layout rendering adapter
- Example editor screen
- Position and dimension write-back to separate view state

Exit criteria:

- A user can open a graph, move nodes, and persist layout state

## Phase 4: CLI Tool Adapter

Goal:

- Make internal tools executable and testable before MCP packaging

Scope:

- Language-neutral CLI command contract
- Tool registry dispatch from CLI commands
- JSON input and output conventions
- Structured error codes
- Query, preview, and mutation command wrappers

Deliverables:

- CLI entrypoint
- Command reference
- Tool-to-command mapping
- Sample command fixtures

Exit criteria:

- Codex or a developer can run documented CLI commands to inspect, preview, and apply graph changes

## Phase 5: Codex Integration

Goal:

- Allow agent-assisted graph editing through bounded actions

Scope:

- Codex host request and response adaptation
- Tool registry definitions
- Context management integration
- Agent contract schemas
- Structured edit delegation
- Internal plugin action routing

Deliverables:

- Codex-facing adapter configuration
- Tool registry
- Context management system
- Agent contract schemas
- Graph edit delegation path

Exit criteria:

- A user can ask Codex to modify a branch and get a validated result

## Phase 6: Plugin Packaging

Goal:

- Convert the project into an installable local plugin

Scope:

- Plugin manifest
- Optional marketplace entry
- Local asset organization
- Runtime wiring

Deliverables:

- `.codex-plugin/plugin.json`
- Optional marketplace registration

Exit criteria:

- The plugin can be discovered and launched in Codex

## Phase 7: MCP Tool Exposure

Goal:

- Expose stable internal tools to Codex through MCP

Scope:

- MCP server wrapper
- External Codex-facing tool schemas
- Mapping from MCP tool calls to internal tools or CLI commands
- Confirmation and mutation safety behavior

Deliverables:

- `.mcp.json`
- MCP server entrypoint
- External tool definitions
- End-to-end Codex tool-call fixtures

Exit criteria:

- Codex can call registered MCP tools and receive structured graph results

## Phase 8: Quality and Extensions

Goal:

- Make the system resilient enough for real usage

Scope:

- Test coverage
- Migration support
- Rich node metadata
- Better layout
- Import/export

Possible extensions:

- Markdown import
- Mermaid import with constraints
- Snapshot history
- Multi-root views
- Collaboration hooks

## Recommended Order of Construction

1. Graph Core
2. Mermaid Compiler
3. Minimal Layout Rendering Engine
4. CLI Tool Adapter
5. Codex Integration Layer
6. Plugin Packaging
7. MCP Tool Exposure
8. Extended features

## Recommended First Demo

The first demo should be intentionally narrow:

1. Load a sample graph JSON document
2. Render it in ReactFlow
3. Generate Mermaid for the focused branch
4. Simulate one structured agent edit
5. Re-render the updated graph

If this demo works cleanly, the architecture is validated.

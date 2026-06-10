# Context Management System

## Purpose

The Context Management System prepares, budgets, injects, and remembers agent-facing context for mind map workflows.

It exists because agents need more than raw JSON or screenshots. They need a scoped, structured view of the graph, plus enough short-term and long-term memory to continue a task coherently without confusing memory with canonical graph truth.

## Core Responsibilities

- Resolve user, tool, or agent-provided scope requests into bounded graph context
- Compose context from graph facts, projections, summaries, Mermaid output, and memory entries
- Budget context size through priority, compression, truncation, and omission metadata
- Produce structured context packets for Codex-facing injection or internal agent workflows
- Maintain session-scoped memory for ongoing tasks
- Provide extension points for durable long-term memory
- Preserve source references for graph-derived context and memory entries

## Internal Subsystems

### Context Builder

Builds graph-derived context from canonical data and query results.

Expected inputs:

- Document id
- `graphVersion`
- User selection, current node, or tool/agent-provided scope request
- Tool name or workflow intent
- Context requirements from the Agent Contract

Expected outputs:

- Included nodes
- Included edges
- Paths, neighborhoods, subtrees, or local projections
- Optional summaries
- Optional Mermaid context requested through the Mermaid Compiler

### Context Budgeter

Controls how much context is returned.

Owned concerns:

- Priority ordering
- Token or size estimates
- Compression strategy
- Truncation strategy
- Omission metadata
- Fallback behavior when requested context is too large

The budgeter should preserve enough identifiers for follow-up tool calls even when labels, descriptions, or summaries are shortened.

### Context Packet Composer

Packages context into a stable structure for tools and agent workflows.

A context packet should include:

- Context purpose
- Document id
- `graphVersion`
- Included node ids
- Included edge ids
- Scoped node content fields when node text may be read or edited
- Projection metadata
- Mermaid text when requested
- Memory entries when relevant
- Omitted or compressed content metadata
- Source references for graph-derived facts

## Node Content Context

Mermaid should remain the structural view. Node text fields should be provided through a separate scoped content block when the agent needs to understand or edit node content.

Default v1 rules:

- Include `title` for nodes in the selected scope.
- Include `cardContent` for selected nodes and nearby nodes when the request involves content editing, summarization, expansion, or review.
- Omit `notes` by default because it may be long and lower priority for map-level reasoning.
- Include `notes` only when the user explicitly asks to inspect, summarize, rewrite, or use long-form node notes.
- Mark omitted or truncated fields explicitly so the agent does not treat unseen content as empty content.
- State which node fields are editable in the current workflow.

Example node content block:

```json
{
  "nodeContent": [
    {
      "nodeId": "market",
      "title": "Market",
      "cardContent": "Market size, segments, competitors, and demand signals.",
      "notes": {
        "included": false,
        "reason": "omitted_by_default"
      },
      "editableFields": ["title", "cardContent"]
    }
  ]
}
```

The agent should use `updateNode` operations to change these fields. It should not infer or overwrite omitted fields.

### Context Injection Adapter

Adapts context packets for Codex-facing workflows.

This adapter should not decide final prompt wording. It should only provide structured payloads that the Codex Integration Layer or agent workflow can insert into the appropriate interaction surface.

### Session Memory

Session Memory stores short-lived workflow state for the current interaction.

Possible examples:

- Current focus node
- Current selected scope
- Recent tool results
- Recent edit proposal ids
- User-stated temporary constraints
- Ambiguities waiting for user confirmation

Session Memory should be invalidated or rechecked when the underlying `graphVersion` changes.

### Long-term Memory

Long-term Memory is an extension point for durable, cross-session context.

Possible examples:

- User preferences for naming, structure, or diagram style
- Reusable graph-editing patterns
- Frequently used templates
- Cross-document project context
- Stable user instructions for agent-assisted mind map editing

Long-term Memory is optional for v1. If introduced, it must keep source references and must not be treated as current graph state.

## Memory Rules

- Canonical graph facts must come from Graph Core and the current `graphVersion`
- Memory entries may guide context selection or editing preferences
- Memory summaries must not override current nodes, edges, labels, or relations
- Graph-derived memory should record document id, `graphVersion`, and source ids when possible
- Stale memory must be marked, refreshed, or ignored when source `graphVersion` values no longer match
- Sensitive or user-specific memory should require explicit storage policy before persistence

## Context Packet Shape

This is a conceptual shape, not a final schema:

```json
{
  "contextId": "ctx_001",
  "purpose": "expand_node",
  "documentId": "doc_001",
  "graphVersion": 12,
  "scope": {
    "type": "subtree",
    "rootNodeId": "topic",
    "maxDepth": 3
  },
  "graph": {
    "nodeIds": ["topic", "child_a"],
    "edgeIds": ["edge_001"]
  },
  "nodeContent": [
    {
      "nodeId": "topic",
      "title": "Topic",
      "cardContent": "Short visible card content.",
      "notes": {
        "included": false,
        "reason": "omitted_by_default"
      },
      "editableFields": ["title", "cardContent"]
    }
  ],
  "mermaid": {
    "included": true,
    "text": "flowchart TD\n  topic[Topic] --> child_a[Child A]"
  },
  "memory": {
    "sessionEntryIds": ["mem_session_001"],
    "longTermEntryIds": []
  },
  "omissions": {
    "nodes": 0,
    "edges": 0,
    "reason": null
  }
}
```

## Boundaries

The Context Management System must not:

- Own canonical graph truth
- Apply graph edits
- Validate edit operations
- Implement Mermaid conversion rules
- Persist extracted projections as document state
- Treat memory summaries as current graph facts without source validation
- Decide final prompt wording or model behavior
- Depend on ReactFlow component state

## V1 Scope

V1 should implement:

- Scope request resolution for current node, user selection, neighbors, and extracted projections
- Mermaid context requests through the Mermaid Compiler
- Basic context size limits
- Structured context packet output
- Minimal session memory for current focus, recent tool results, and pending confirmations

V1 should defer:

- Durable long-term memory
- Cross-document memory
- Memory indexing and retrieval
- Preference learning
- Automatic memory persistence

## Open Questions

- Which session memory entries should survive `graphVersion` changes?
- Should long-term memory be user-scoped, document-scoped, workspace-scoped, or plugin-scoped?
- What storage policy is required before persistent memory is enabled?
- Should memory be exposed to agents through tools or only through context packets?
- How should the system summarize large graph regions without losing edit-critical ids?

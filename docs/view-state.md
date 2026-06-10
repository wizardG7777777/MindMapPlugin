# View State

## Purpose

View state stores presentation and interaction state for a graph view.

It is separate from canonical graph data. The canonical document stores graph facts; view state stores how a particular view presents and interacts with those facts.

## Ownership

View state is owned by the Layout Rendering Engine and persisted by the Persistence Layer when needed.

The Layout Rendering Engine may read and update view state for:

- Node positions
- Measured node dimensions
- Collapsed or expanded state
- Current selection
- Focus node
- Canvas viewport
- Layout mode or per-view layout cache

## Example Shape

```json
{
  "documentId": "doc_001",
  "viewId": "default",
  "positions": {
    "topic": { "x": 0, "y": 0 },
    "market": { "x": 240, "y": -80 }
  },
  "dimensions": {
    "topic": { "width": 180, "height": 72 },
    "market": { "width": 220, "height": 96 }
  },
  "collapsed": [],
  "selection": {
    "nodeIds": ["market"],
    "edgeIds": []
  },
  "focusNodeId": "market",
  "viewport": {
    "x": 0,
    "y": 0,
    "zoom": 1
  }
}
```

## Field Intent

- `documentId` links view state to a canonical graph document
- `viewId` identifies one saved view for the same document
- `positions` stores node coordinates used by the renderer
- `dimensions` stores measured or estimated node sizes
- `collapsed` stores nodes hidden or folded in the current view
- `selection` stores the current UI selection
- `focusNodeId` stores the current primary node for agent context or keyboard focus
- `viewport` stores canvas pan and zoom state

## Boundaries

View state must not:

- Define graph truth
- Store node titles, card content, notes, or semantic metadata
- Store edge semantics
- Change `entryNodeId`
- Replace canonical graph validation
- Be required to validate canonical graph data
- Be treated as Agent-editable graph structure by default

## Relationship To Agent Context

The Context Management System may read selection and focus state when preparing context for an agent workflow.

For example:

```text
selection.nodeIds
  -> Context Management System
  -> graph query or projection
  -> Mermaid Compiler when needed
  -> Context Packet
```

Selection and focus are context hints, not canonical graph facts.

## Persistence Rules

View state may be persisted, but it should be versioned and stored separately from the canonical graph document.

Recommended rules:

- Missing view state should not make a graph invalid
- A renderer should be able to regenerate layout when positions are missing
- Stale positions may be ignored after major graph edits
- Selection may be session-only unless explicitly saved
- Multiple view-state documents may exist for the same canonical graph

## WebUI Scope

The localhost WebUI sidecar persists display-only state through `GET/POST /api/view-state`.

Current WebUI persistence includes:

- Node positions
- Canvas viewport

Current WebUI persistence excludes:

- Node titles, card content, notes, or metadata
- Edge semantics
- Canonical graph operations
- Selection, which remains session state for the Codex context bridge

The sidecar validates `graphVersion` and node ids before writing view-state. Writes go to `.mindmap/view-state/` by default and never modify the canonical document.

## V1 Scope

V1 should support:

- `documentId`
- `viewId`
- `positions`
- `dimensions`
- `collapsed`
- `selection`
- `focusNodeId`
- `viewport`

V1 should defer:

- Multiple named layouts
- Per-user view state
- Collaborative cursor state
- Renderer-specific component props
- Advanced animation or transition state

# Theme and Template Configuration

## Purpose

Theme and template configuration maps canonical graph semantics to visual rendering behavior.

It allows the same canonical graph to be displayed with different visual styles, layout defaults, and interaction affordances without changing graph truth.

## Ownership

Theme and template configuration is consumed by the Layout Rendering Engine.

It may be loaded by the Persistence Layer or plugin runtime, but it is not stored inside the canonical graph document.

## Core Idea

The canonical graph stores semantic fields:

- `diagramKind`
- node metadata
- edge `kind`
- edge `order`

The theme/template layer maps those semantics to visual behavior:

- layout mode
- node renderer type
- node shape
- edge renderer type
- edge shape
- spacing
- typography
- colors
- markers
- handles

## Example Shape

```json
{
  "themeId": "default-mindmap",
  "version": 1,
  "diagramKind": "mindmap",
  "layout": {
    "mode": "tree-lr",
    "rankGap": 160,
    "nodeGap": 40
  },
  "nodes": {
    "default": {
      "rendererType": "topic-card",
      "shape": "rounded-rect",
      "titleTypography": "heading-sm",
      "cardTypography": "body-sm"
    },
    "priority": {
      "match": {
        "meta.tags": ["priority"]
      },
      "rendererType": "topic-card",
      "shape": "rounded-rect",
      "accent": "warning"
    }
  },
  "edges": {
    "contains": {
      "rendererType": "smoothstep",
      "marker": "arrow",
      "stroke": "solid"
    },
    "references": {
      "rendererType": "dashed-reference",
      "marker": "arrow",
      "stroke": "dashed"
    }
  }
}
```

## Field Intent

- `themeId` identifies the selected theme or template
- `version` supports future theme migrations
- `diagramKind` identifies which graph expression the theme is intended for
- `layout` defines default layout strategy and spacing
- `nodes` maps semantic node conditions to renderer choices
- `edges` maps semantic edge kinds to renderer choices

## Boundaries

Theme and template configuration must not:

- Define canonical graph nodes or edges
- Store node positions or measured dimensions
- Store current selection, viewport, or focus state
- Change graph semantics
- Replace Graph Core validation
- Require a canonical graph rewrite when the user switches themes

## Relationship To `diagramKind`

`diagramKind` belongs in canonical graph data because it changes how the graph should be understood.

Theme/template configuration uses `diagramKind` to choose visual defaults. For example:

- `mindmap` may default to a tree or radial layout
- `fishbone` may default to a cause-and-effect layout
- `flowchart` may default to a layered directional layout
- `dependency-graph` may default to a force-directed or layered graph layout

## Relationship To View State

Theme/template configuration defines visual rules. View state stores runtime presentation state.

For example:

- Theme/template may define default `rankGap`
- View state may store the actual position of a node after the user drags it
- Theme/template may define edge renderer type
- View state may store which nodes are collapsed

## V1 Scope

V1 should support:

- One default theme for `mindmap`
- Default layout mode
- Default node renderer
- Edge renderer mapping for `contains` and `references`
- Basic spacing values
- Basic typography and accent tokens

V1 should defer:

- Full theme editor UI
- User-authored theme marketplace
- Per-node manual style overrides
- Animated transitions
- Complex conditional style rules

# Theme and Template Configuration

Status: deferred visual-interface design. The headless first delivery has no visual layout engine requirement.

## Separate responsibilities

| Concern | Owner | Example |
| --- | --- | --- |
| Graph topology | Canonical graph | Directed edges, including cycles |
| Semantic meaning | Canonical graph | A relationship means “depends on” |
| Layout | Future view/template | Layered, circular, radial or fishbone placement |
| Appearance | Future theme | Shapes, typography, colors and edge markers |
| Actual positions | Future saved view | Coordinates after a person moves a node |

A circular layout must not create a closing edge. A cyclic graph must not require circular placement. A semantic label such as `flowchart` or `fishbone` does not guarantee that a matching visual renderer exists.

## Future template rules

Templates map semantic attributes to display defaults without rewriting nodes or edges. Switching templates does not change graph version. Invalid or unavailable display configuration must not make a valid graph unreadable from the CLI.

Future capabilities must separately report implemented visual layouts and semantic content support. A type label alone is not evidence of layout support. Manual positions, view focus and selection belong to [view state](view-state.md), not template definitions.

## Deferred scope

Layout algorithms, shape/edge renderer mappings, layout measurement, themes and a theme editor are outside the first-delivery implementation and acceptance gates. The initial CLI reports no visual layouts. Mermaid is structural text output under its own [projection contract](mermaid-projection.md), not a promised visual layout.

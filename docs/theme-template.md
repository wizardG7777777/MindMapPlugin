# Layout, Appearance and Templates

Status: headless layout and fixed SVG appearance are implemented. Interactive theme editing and persistent manual views remain deferred.

| Concern | Owner | Example |
| --- | --- | --- |
| Graph topology | Canonical graph | Directed edges, including cycles |
| Semantic meaning | Canonical graph/profile conventions | A decision, merge or retry relationship |
| Layout policy | Presentation strategy | Equal-layer alternatives, a rooted hierarchy or a fishbone spine |
| Measured geometry | Presentation engine | Node boxes and routed edge polylines |
| Appearance | SVG renderer | Role shapes, fonts, colors and arrow markers |
| Manual positions | Future saved view | User-specific coordinate overrides |

The implemented profiles are `flowchart`, `mindmap`, `dependency`, `network` and `fishbone`. CLI selection, profile semantics, typography and exact output fields are defined in [rendering](rendering.md). Layout is independent of a browser or interactive editor.

A circular arrangement never creates a closing edge. A cyclic graph never requires circular placement. Switching the presentation profile does not change graph content or graph version. Unsupported layout constraints fail clearly while the source graph remains readable through ordinary CLI queries.

The current SVG renderer provides a fixed, safe palette and packages its measured font. Theme selection, arbitrary style configuration and a theme editor are future additions. Persistent drag positions, view focus and selections belong to [view state](view-state.md). They are not a reason to delay deterministic CLI layout or SVG delivery.

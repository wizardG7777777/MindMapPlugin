# Layout and Artifact Rendering

Status: implemented headless presentation contract, layout version 1. Graph facts and transactions remain governed by the existing document and operation schemas. Rendering reads one snapshot and never changes its bytes, receipts, version or coordination files.

## Commands and formats

```sh
mindmap render ./plan.json --format svg --layout flowchart --orientation TD --raw > plan.svg
mindmap render ./plan.json --format mermaid --raw > plan.mmd
mindmap render ./plan.json --format mermaid --layout-hints --raw > plan-with-hints.mmd
mindmap render ./plan.json --format svg --json
mindmap schema layout --json
```

`render` selects the complete graph; it has no node/edge truncation or implicit current selection. `--format svg|mermaid` is required. `--layout` accepts `auto`, `flowchart`, `mindmap`, `dependency`, `network` or `fishbone`. `--root <id>` overrides the presentation entry for this invocation. `--orientation TD|LR` defaults to TD for flowchart/dependency and LR otherwise. Graph and operation versions are unchanged by these options.

Without `--raw`, success uses the common result envelope and `data` has exactly `{format, text, layout, layoutHints, warnings}`. SVG returns its complete measured `layout`; `layoutHints` is null. Mermaid returns `layout: null` and optional `layoutHints`, null unless requested. `warnings` always contains structured `{code, message, nodeIds, edgeIds}` records. JSON output obeys the existing one-object stdout contract.

`--raw` writes only the selected artifact text to stdout. It is incompatible with `--json`. Errors for `render --raw` leave stdout empty and put the error envelope on stderr with the normal nonzero exit code. `--help` still returns help. Redirect artifacts to their own destination file. The CLI does not open a browser, bind a port or launch a renderer process.

`--layout-hints` is available for Mermaid only. It includes the layout object in JSON output and as a single `%% mindmap-layout-v1: {...}` comment in Mermaid text. Standard Mermaid frontmatter supplies node/rank spacing hints. Comments include exact intended coordinates, roles, groups, retry edges and same-layer constraints. External Mermaid hosts may ignore these constraints or use different metrics. SVG is the authoritative geometry-preserving output; Mermaid remains an interoperable structural projection, not a promise that another host will reproduce our coordinates.

Scoped context also supports hints:

```sh
mindmap context ./plan.json --all --mermaid --layout-hints --layout flowchart --orientation TD --json
```

Context `--layout-hints` requires `--mermaid`; context `--layout` requires both. Hints cover only returned internal nodes/edges, retain the query's omissions/boundaries, and never invent outside nodes. A decision whose merge lies outside the scope gets a `MERGE_OUTSIDE_SCOPE` warning. Node titles are measured as returned, including any explicit query truncation. Raw artifact output is provided by `render`, not by changing context's result format.

## Responsibility boundaries

| Module | Responsibility |
| --- | --- |
| Semantic interpretation | Resolve graph profile, entry, roles, alternatives, merge points and return edges |
| Layout strategy | Derive rank/branch/tree/component constraints for that profile |
| Geometry engine | Place measured boxes, route edges around nodes and position labels |
| SVG renderer | Draw the resulting positions, outlines, arrows and labels |
| Mermaid adapter | Emit structural source and optional advisory layout metadata |

Implementations live under `src/presentation/`. Geometry and output code cannot mutate graph data. Coordinates, fonts, shapes and view bounds are derived results. Semantic roles belong to optional `meta.flow` attributes, not to saved coordinates.

## Profile selection and behavior

| Profile | `auto` semantic types | Layout behavior |
| --- | --- | --- |
| `flowchart` | `flowchart`, `control-flow`, any type ending in `-flowchart` | Entry-first execution layers, equal-layer alternatives, downstream merges, side error branches, separately routed return edges |
| `mindmap` | `mindmap`, `mind-map` | Rooted hierarchy; prefer `contains` edges for the spanning forest; retain other parents, parallel edges, cycles and cross-links as secondary relationships |
| `dependency` | `dependency`, `dependency-graph` | Directed dependency layers; strongly connected components share a layer and get a visible cycle group; between-component arrows progress in the selected direction |
| `network` | All other types, including `general`, `concept-map`, `network` | Deterministic force placement, rectangle separation and separate disconnected components; no execution-order claim; orientation biases placement/component packing |
| `fishbone` | `fishbone`, `cause-effect` | Selected entry is the effect/root; categories alternate around a shared spine and deeper causes expand outward; original edge directions are retained |

One generic graph can be viewed with different profiles. This does not convert it to a tree or remove edges. Directed cycles remain valid; a profile's constraints may require additional semantic information to lay them out clearly. For dependency graphs, rank follows the actual source-to-target direction; the renderer does not infer whether a custom edge label means “depends on” or “is prerequisite for”. For fishbone, choose the effect with `entryNodeId` or `--root`.

## Control-flow semantics

Nodes may use `meta.flow` with exactly:

```json
{"role":"decision","mergeNodeId":"account"}
```

`role` is required and is one of `start`, `action`, `decision`, `merge`, `end`, `error`. `mergeNodeId` is optional and permitted only for a decision; it must identify a merge reachable from each alternative when rendering the whole graph. Start/end use rounded shapes; decisions use diamonds. Other roles use rectangular cards with role-specific emphasis.

Edges may use `meta.flow` with exactly:

```json
{"role":"retry"}
```

Edge roles are `forward`, `branch`, `error`, `retry`. A decision's multiple non-error outgoing paths, or an explicit set of outgoing `branch` edges, form alternatives. These are mutually exclusive choices, not an AND fork/join. Entrances share the same execution layer. Completion nodes align when compatible; a one-step short branch instead uses a longer connector. A merge follows all relevant forward predecessors. Nested choices reserve their own branch space.

Explicit `retry` edges do not participate in forward ranking. Error nodes are placed beside the main flow. For unannotated cyclic graphs, an entry-first traversal can infer return edges and emits `INFERRED_RETRY_EDGES`; users and agents should supply semantic roles when this distinction matters. The engine does not infer semantics from Chinese/English prose labels. Explicitly forward cycles or contradictory equal-layer requirements fail `INVALID_LAYOUT` rather than silently reversing a business relationship.

These are opt-in profile conventions inside the existing semantic metadata extension point. Core JSON/graph validation and ordinary queries remain independent of a specific visual profile. The `layout` schema includes `flowNode` and `flowEdge` definitions; malformed or contradictory flow annotations are diagnosed when that profile is rendered. `updateNode`/`updateEdge` can edit these attributes through the usual transaction, remembering that a meta patch replaces the whole object.

## Geometry and complete output

`schema layout` defines the exact measured scene: profile, orientation, presentation entry, canvas bounds, node boxes/roles/text lines/ranks, every canonical edge with its polyline and label box, semantic groups, same-layer constraints, primary/return/secondary edge IDs, warnings and font identity. Coordinates are SVG units. Node positions are top-left; execution alignment compares box centers. The current numeric tolerance used for alignment verification is 0.01 SVG units.

The layout includes every selected node and edge, including isolated nodes, self-loops and parallel relationships. Edges never reverse their canonical source and target to improve rank. Return and cross edges are visually distinguished. Routes avoid node interiors and unrelated dependency-cycle group interiors; edge labels cannot cover nodes or each other. Dense or contradictory inputs that exceed the supported geometric constraints fail explicitly instead of returning a partly missing diagram.

Rendering is bounded to 500 nodes, 2000 edges, 512 Unicode code points per document/node title or edge label, and 32 MiB of SVG text. Bounds are reported as `renderLimits` in capabilities. They are separate from document storage and query limits. Exceeding a bound returns `LIMIT_EXCEEDED`, never a silently truncated SVG or a graph mutation. A raw Mermaid render shares the record/text bounds but does not load fonts or compute geometry unless hints are requested.

## Typography and safe SVG

The package includes Noto Sans CJK SC Regular 2.004, its SIL Open Font License and pinned source/hash. Fontkit measures and shapes text with that font. SVG contains reused glyph outlines, so the viewer needs no installed font, font download, script, external image or browser-specific text measurement. Node and edge titles remain available as accessible labels/titles; the visible glyphs are paths rather than editable SVG text elements.

Unsupported characters are rendered as explicit `[U+...]` code-point placeholders with `MISSING_GLYPH` diagnostics. The source document is unchanged. User-provided strings are XML-escaped and invalid XML control characters are represented safely. The fixed renderer palette does not accept arbitrary scripts, CSS or external URLs from metadata.

## Verification

`test/layout.test.js` checks complete node/edge preservation, actual SVG parsing and rasterization, login entry placement, A/B/C entrance/completion alignment in both orientations, downstream merge ordering, nested/short alternatives, ID-renaming stability, no node/label overlap, Unicode safety, raw streams, Mermaid parsing with/without hints, context scope and explicit failures. Package acceptance repeats these checks through an immutable installation and exercises SVG/Mermaid output in the network-denied sandbox. Visual review of the generated login SVG and profile gallery complements numerical checks; parser success alone is not visual acceptance.

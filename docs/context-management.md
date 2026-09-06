# Independent Queries and Context

Status: target CLI contract version 1. A context is the result of an explicit query against one snapshot, not a shared agent session.

## Reader isolation

Every request specifies its file and selectors. No read writes focus, selection, recent results or memory back to the program. A person, Kimi and GPT may use unrelated scopes concurrently. A saved result remains an observation of its reported version; the program does not promise later queries can reopen that historical version.

A query loads and validates the complete committed file once, then constructs all counts, records, omissions and Mermaid from that in-memory snapshot. It must not reopen the file for a second part of the same response. Missing IDs fail explicitly. The graph's entry node never overrides explicit selectors.

## Scope resolution

For scoped `context`, seeds are the specified node IDs plus both endpoints of explicitly selected edges. Explicit edges and seeds must be included, even when not encountered through traversal. An explicitly selected edge excluded by `--kinds` is an invalid argument rather than a silently dropped selection.

Expand seeds breadth-first through edges matching the kind filter and requested direction. Assign each reached node its minimum distance from any seed. Visit a node at most once for expansion, and stop expansion at the requested depth. Sort same-distance candidates by canonical ID using locale-independent code-point order. Traversal stops at repeated nodes without deleting the relationships that led to them.

`--all` selects all nodes, including disconnected components, sorted by ID; the kind filter limits relationships only. It has no implicit entry root. `neighbors` is the same query mechanism with one node seed and depth 1.

Select returned nodes from eligible candidates by distance then ID (or ID for `--all`), preserving all explicit seeds first. After node selection, internal candidate edges are **all** matching canonical edges with both endpoints returned, including back edges, cross edges, parallel edges and self-loops. Keep explicit edges first, then fill by edge ID order. If explicit seeds or explicit edges exceed limits, fail `LIMIT_EXCEEDED` with required minimums instead of silently dropping them.

## Boundary relationships and omissions

A boundary candidate is a matching edge with exactly one endpoint in the returned node set, regardless of whether the other endpoint lies beyond requested depth or was omitted by a node limit. Return ID-sorted boundary records up to the independent boundary limit. Records carry `{id, source, target, kind}` without inventing content for the outside node. They are not internal edges or duplicated nodes.

`omissions.nodes` counts eligible scope nodes excluded by `maxNodes`; it does not count the entire rest of the document. `omissions.edges` counts internal candidate edges excluded by `maxEdges`. `omissions.boundaryEdges` counts boundary candidates beyond the boundary limit. Depth is a requested scope boundary, not proof that no further nodes exist. Even when limits apply, full counts are computed from the same snapshot, not inferred from the truncated result.

## Content selection

Every returned node contains `id` and `title`. `card` adds `cardContent`; `all` additionally adds `notes` and `meta`. Unselected card/notes/meta fields are absent and each is listed in `omissions.fields` with `{nodeId, field, reason: "not_requested", omittedBytes}`. `omittedBytes` is the UTF-8 size of its string or compact JSON representation for meta. Title mode can therefore distinguish missing content from empty stored content.

For selected title/card/notes, a zero `maxTextBytes` returns the complete field; otherwise apply `maxTextBytes` per field, cutting only at Unicode code-point boundaries and returning `{nodeId, field, reason: "text_limit", omittedBytes}` for shortened fields. No mutation may treat shortened or absent fields as the full original. Meta in all mode is returned intact. For the `node` command, use the same content rules with no traversal.

## Context result data

The common [result envelope](command-contract.md) carries `documentId` and `graphVersion`. Context `data` has exactly:

- `scope`: `{mode, nodeIds, edgeIds, direction, depth, kinds, limits}`; original explicit selectors, deduplicated only by validation (duplicates are rejected). Mode is `all`, `ids` or `neighbors`; all uses empty selector arrays, null direction/depth, and kinds is null or the supplied unique string array.
- `nodes`: normalized returned node records with fields selected/truncated above, sorted by ID.
- `edges`: full returned internal canonical edge records, sorted by ID.
- `boundaryEdges`: crossing records defined above.
- `omissions`: `{nodes, edges, boundaryEdges, fields}` with nonnegative counts and field markers sorted by node ID then field name.
- `mermaid`: null unless requested, otherwise the object defined in [Mermaid projection](mermaid-projection.md).

Filters, limits and sorting are deterministic. Output nodes are sorted by ID even though breadth-first priority determines which nodes fit. The `scope.limits` field contains `{maxNodes, maxEdges, maxBoundaryEdges, maxTextBytes}` so a saved result explains its omissions.

There is no implicit write scope in a context result. A caller forms an explicit operation scope independently. Context generation never claims omitted graph content does not exist and never modifies the graph to make it tree-shaped.

## First-delivery boundary

No host-specific prompt injection, session memory, persistent focus, semantic summarization model or long-term memory subsystem is required. The caller can save results or request a wider scope. If a valid document exceeds context record budgets, `export` provides the complete snapshot for ID discovery and data retrieval. To read a known node's entire long text, use `node --content all --max-text-bytes 0`; no selected field then has an artificial 1 MiB ceiling. These features cannot become hidden dependencies of query correctness.

## Optional layout hints

`--mermaid --layout-hints` adds the measured layout object to `data.mermaid.layoutHints`. Layout applies only to returned internal nodes/edges, never to omitted or boundary nodes. The default structural Mermaid object retains its original fields when hints are absent. A merge outside the selected context is reported with `MERGE_OUTSIDE_SCOPE`; canonical metadata is unchanged. Profile selection and limits are defined in [rendering](rendering.md). Use `render` to produce a complete graph artifact without context record budgets.

---
name: mindmap-cli
description: Read, create, edit and lay out local directed graphs with the MindMap CLI; export SVG or Mermaid, including cyclic and non-tree graphs. Use for this program's graph workflow when local command execution is available.
---

# MindMap CLI

These instructions target CLI contract version 1. Check the installed program before relying on them: `mindmap --version --json` and `mindmap capabilities --json`. The expected product identity is `mindmap-cli`. If the executable is unavailable or incompatible, report that specific condition; do not conclude that directed graphs are unsupported or silently substitute another similarly named tool.

Use `mindmap --help`, command help and `mindmap schema operations --json` to discover the actual interface. Capability/schema output is authoritative for the installed release. The installed package also includes CLI reference and workflow documentation; the skill itself requires no separately installed references.

## Independent reads

Choose the document and selectors needed for the user's task. People and other agents may read different scopes concurrently; there is no shared current selection to inherit. Returned context belongs to its stated graph version. Combine required scopes in one request if they must share a snapshot. Read omitted or truncated fields before using their full value in an edit. Use `node --content all --max-text-bytes 0` for complete text, or `export` for complete ID/content discovery beyond context limits.

The graph supports cycles, self-loops, parallel edges, multiple parents and disconnected nodes. A circular layout and a directed cycle are different requests. Use `capabilities` to discover implemented layouts and output formats. Current profiles include flowchart, mindmap, dependency, network and fishbone; interactive editing is separate from headless rendering.

## Edits

Express the authorized change as an operation file with document ID, base version, unique operation ID and explicit write scope. Prefer files or stdin over complex shell quoting. Scope must include indirect effects such as endpoints and incident edges; a read result does not grant edit authority.

Preview structural or broad edits so the actual diff can be reviewed, then apply through the CLI and verify by rereading the relevant graph. Do not overwrite the document file or treat Mermaid as a mutation format. The program's actor label is attribution, not a way to bypass restrictions.

On `CONFLICT`, reread and reconsider the batch before issuing a revised operation ID/version. On a lost or uncertain apply result, retry exactly the same bytes and operation ID; changing either can duplicate an edit. Check the returned receipt and current version. Do not infer that a failed response means nothing was saved.

The executable does not need a running browser, server or agent platform. Avoid claiming a command is implemented based only on these target-specification files; report what the installed executable actually supports and what was verified.

## Layout and delivery

For a visual diagram, use `render --format svg --raw` and write the artifact to a distinct output file. SVG preserves the program's measured geometry and includes its glyph outlines. Inspect the actual rendered artifact before reporting visual completion.

For a control flow, describe start, decision, merge, end and error nodes through optional `meta.flow` semantics, and distinguish forward/branch/error/retry edges. Set the entry and a decision's merge when known. Discover the exact conventions through `schema layout` (`flowNode`/`flowEdge` definitions). Preserve other metadata when applying a meta replacement. A/B/C choice paths are mutually exclusive alternatives, not an AND fork.

`render --format mermaid --raw` emits standalone source. Add `--layout-hints` for standard spacing hints and the program's measured geometry as an inert comment; JSON mode also returns the layout hints as structured data. External Mermaid viewers may ignore these hints. Use SVG when the delivered geometry must match. `context --mermaid --layout-hints` describes only that query's returned scope, including its omissions and boundary limitations.

Inspect layout warnings, especially inferred return edges or unsupported glyphs. Explicit semantic roles are preferable to guessing execution order from titles. Rendering is read-only and does not acquire a graph commit lock or alter the document version.

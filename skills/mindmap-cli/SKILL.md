---
name: mindmap-cli
description: Read, create and edit local directed-graph documents through the MindMap CLI, including cyclic and non-tree graphs. Use for this program's graph workflow when local command execution is available.
---

# MindMap CLI

These instructions target CLI contract version 1. Check the installed program before relying on them: `mindmap --version --json` and `mindmap capabilities --json`. The expected product identity is `mindmap-cli`. If the executable is unavailable or incompatible, report that specific condition; do not conclude that directed graphs are unsupported or silently substitute another similarly named tool.

Use `mindmap --help`, command help and `mindmap schema operations --json` to discover the actual interface. Capability/schema output is authoritative for the installed release. The installed package also includes CLI reference and workflow documentation; the skill itself requires no separately installed references.

## Independent reads

Choose the document and selectors needed for the user's task. People and other agents may read different scopes concurrently; there is no shared current selection to inherit. Returned context belongs to its stated graph version. Combine required scopes in one request if they must share a snapshot. Read omitted or truncated fields before using their full value in an edit. Use `node --content all --max-text-bytes 0` for complete text, or `export` for complete ID/content discovery beyond context limits.

The graph supports cycles, self-loops, parallel edges, multiple parents and disconnected nodes. A circular layout and a directed cycle are different requests. The headless release has no visual layout capability; structural Mermaid is an optional output for both people and agents.

## Edits

Express the authorized change as an operation file with document ID, base version, unique operation ID and explicit write scope. Prefer files or stdin over complex shell quoting. Scope must include indirect effects such as endpoints and incident edges; a read result does not grant edit authority.

Preview structural or broad edits so the actual diff can be reviewed, then apply through the CLI and verify by rereading the relevant graph. Do not overwrite the document file or treat Mermaid as a mutation format. The program's actor label is attribution, not a way to bypass restrictions.

On `CONFLICT`, reread and reconsider the batch before issuing a revised operation ID/version. On a lost or uncertain apply result, retry exactly the same bytes and operation ID; changing either can duplicate an edit. Check the returned receipt and current version. Do not infer that a failed response means nothing was saved.

The executable does not need a running browser, server or agent platform. Avoid claiming a command is implemented based only on these target-specification files; report what the installed executable actually supports and what was verified.

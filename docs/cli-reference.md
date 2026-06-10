# CLI Reference

The MVP CLI exposes the same internal tools intended for later MCP transport.

Run commands from the repository root with:

```bash
PYTHONPATH=src python3 -m mindmap_plugin.cli <command>
```

## Query Commands

- `validate-document --document <path>`
- `get-document-summary --document <path>`
- `get-node --document <path> --node-id <id>`
- `get-neighbors --document <path> --node-id <id> --direction incoming|outgoing|both`
- `extract-subtree --document <path> --start-node-id <id> --direction outgoing --max-depth 3`
- `compile-mermaid-context --document <path> [--start-node-id <id>] [--include-node-content card]`
- `render-reactflow-view --document <path> [--view-state <path>]`

## Mutation Commands

- `preview-operations --document <path> --operations <path>`
- `apply-operations --document <path> --operations <path> [--output <path>]`

Mutation commands accept the operation envelope defined in `docs/operation-schema.md`.
`apply-operations` writes the updated document to `--output`, or overwrites `--document` when `--output` is omitted.

## Examples

```bash
PYTHONPATH=src python3 -m mindmap_plugin.cli validate-document --document samples/documents/sample-mindmap.json
PYTHONPATH=src python3 -m mindmap_plugin.cli compile-mermaid-context --document samples/documents/sample-mindmap.json --start-node-id market
PYTHONPATH=src python3 -m mindmap_plugin.cli preview-operations --document samples/documents/sample-mindmap.json --operations samples/operations/add-pricing.json
```

## Contract Tests

The repository includes pytest-based contract tests that check the agent-facing tool outputs and edit safety behavior:

```bash
PYTHONPATH=src python3 -m pytest
```

These tests focus on:

- Mermaid context shape
- `projectionSupport` mappings
- cycle markers
- node content handoff
- operation preview/apply behavior
- `graphVersion` conflict checks
- scope restriction rejection
- MCP tool exposure

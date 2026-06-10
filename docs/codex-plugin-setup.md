# Codex Plugin Setup

This project is registered as a home-local Codex plugin.

## Local Registration

The plugin is exposed through:

- Plugin root symlink: `/Users/yanchenyu/plugins/mind-map`
- Source project: `/Users/yanchenyu/Documents/WebApps/codexPlugin/mindMap`
- Marketplace file: `/Users/yanchenyu/.agents/plugins/marketplace.json`
- Marketplace entry path: `./plugins/mind-map`

The marketplace entry is:

```json
{
  "name": "mind-map",
  "source": {
    "source": "local",
    "path": "./plugins/mind-map"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```

## Plugin Components

- Manifest: `.codex-plugin/plugin.json`
- MCP config: `.mcp.json`
- MCP server: `src/mindmap_plugin/mcp_server.py`
- Internal tool registry: `src/mindmap_plugin/tools.py`

The MCP config uses an absolute `PYTHONPATH` so the server can start even if Codex launches it from a different working directory.

## Exposed MCP Tools

The plugin exposes these Codex-facing tools:

- `mindmap_get_document_summary`
- `mindmap_get_node`
- `mindmap_get_neighbors`
- `mindmap_extract_subtree`
- `mindmap_compile_mermaid_context`
- `mindmap_preview_operations`
- `mindmap_apply_operations`
- `mindmap_render_reactflow_view`
- `mindmap_get_current_selection`
- `mindmap_build_context_from_selection`
- `mindmap_validate_document`

## Verification Commands

Validate the local runtime:

```bash
PYTHONPATH=src python3 -m mindmap_plugin.cli validate-document --document samples/documents/sample-mindmap.json
```

Validate agent-facing Mermaid context:

```bash
PYTHONPATH=src python3 -m mindmap_plugin.cli compile-mermaid-context --document samples/documents/sample-mindmap.json --start-node-id market --max-depth 3
```

Run the contract tests:

```bash
PYTHONPATH=src python3 -m pytest
```

## Codex App Usage

After changing `~/.agents/plugins/marketplace.json`, Codex may need to reload its plugin catalog or restart before the local plugin appears.

Once installed/enabled in Codex, use the plugin tools with an explicit canonical graph file path, for example:

```text
Use the mind-map plugin to summarize this document:
/Users/yanchenyu/Documents/WebApps/codexPlugin/mindMap/samples/documents/sample-mindmap.json
```

For graph edits, the agent should:

1. Call `mindmap_compile_mermaid_context` or another query tool
2. Produce a typed operation envelope
3. Call `mindmap_preview_operations`
4. Call `mindmap_apply_operations` only after the preview is acceptable

## Current Boundary

The Codex plugin backend and MCP tool surface are implemented and locally registered.

The full ReactFlow visual editor is not implemented yet. `mindmap_render_reactflow_view` currently returns ReactFlow-compatible nodes and edges as a projection contract for the future UI.

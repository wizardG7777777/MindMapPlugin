from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from mindmap_plugin.errors import ConflictError, ValidationError
from mindmap_plugin.graph_core import apply_operations, preview_operations
from mindmap_plugin.layout import to_reactflow_view
from mindmap_plugin.mcp_server import TOOLS
from mindmap_plugin.mermaid import compile_document_to_mermaid_context
from mindmap_plugin.projections import extract_subtree

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_DOCUMENT = ROOT / "samples" / "documents" / "sample-mindmap.json"
SAMPLE_OPERATION = ROOT / "samples" / "operations" / "add-pricing.json"


def load_document() -> dict:
    return json.loads(SAMPLE_DOCUMENT.read_text(encoding="utf-8"))


def load_operation_envelope() -> dict:
    return json.loads(SAMPLE_OPERATION.read_text(encoding="utf-8"))


def test_mermaid_context_contains_agent_editing_support() -> None:
    document = load_document()
    context = compile_document_to_mermaid_context(document, start_node_id="market", max_depth=3)

    assert context["ok"] is True
    assert context["documentId"] == "doc_001"
    assert context["graphVersion"] == 7
    assert context["includedNodeIds"] == ["market", "research"]
    assert context["includedEdgeIds"] == ["edge_market_research", "edge_research_market"]
    assert context["mermaid"] == "\n".join(
        [
            "flowchart LR",
            '  n_market["Market"]',
            '  n_research["Research"]',
            "",
            '  n_market -->|"contains order=0"| n_research',
            '  n_research -->|"references cycle"| n_market',
        ]
    )
    assert context["projectionSupport"]["nodes"]["n_market"]["nodeId"] == "market"
    assert context["projectionSupport"]["edges"]["p_1_edge_research_market"] == {
        "edgeId": "edge_research_market",
        "source": "research",
        "target": "market",
        "kind": "references",
        "marker": "cycle",
    }
    assert context["nodeContent"]["market"] == {
        "title": "Market",
        "cardContent": "Market size, segments, competitors, and demand signals.",
        "notesOmitted": True,
    }
    assert "graph" not in context
    assert "metadata" not in context


def test_subtree_projection_breaks_cycles_without_persisting_traversal_state() -> None:
    document = load_document()
    projection = extract_subtree(document, "market", max_depth=3)

    assert projection["markers"] == [
        {
            "edgeId": "edge_research_market",
            "source": "research",
            "target": "market",
            "marker": "cycle",
        }
    ]
    assert projection["edges"]["edge_research_market"]["marker"] == "cycle"
    assert "hasVisited" not in json.dumps(projection)
    assert "edge_research_market" in projection["includedEdgeIds"]


def test_preview_is_atomic_and_keeps_document_unchanged() -> None:
    document = load_document()
    operation_envelope = load_operation_envelope()
    before = json.dumps(document, sort_keys=True)
    preview = preview_operations(document, operation_envelope)

    assert preview == {
        "ok": True,
        "documentId": "doc_001",
        "baseGraphVersion": 7,
        "nextGraphVersion": 8,
        "operationCount": 2,
        "affectedNodeIds": ["pricing"],
        "affectedEdgeIds": ["edge_market_pricing"],
        "summary": "2 operation(s), 1 node(s), 1 edge(s) affected.",
    }
    assert json.dumps(document, sort_keys=True) == before


def test_apply_uses_graph_version_not_json_schema_version() -> None:
    document = load_document()
    operation_envelope = load_operation_envelope()
    updated, result = apply_operations(document, operation_envelope)

    assert result["applied"] is True
    assert updated["JSON-SchemaVersion"] == 1
    assert updated["metadata"]["graphVersion"] == 8
    assert updated["graph"]["nodes"]["pricing"]["title"] == "Pricing"


def test_stale_graph_version_is_rejected() -> None:
    document = load_document()
    operation_envelope = load_operation_envelope()
    operation_envelope["baseGraphVersion"] = 6

    try:
        preview_operations(document, operation_envelope)
    except ConflictError:
        return
    raise AssertionError("Expected ConflictError")


def test_scope_restrictions_reject_out_of_scope_agent_edit() -> None:
    document = load_document()
    operation_envelope = load_operation_envelope()
    operation_envelope["scopeRestrictions"] = {
        "allowedNodeIds": ["market"],
        "disallowDeleteOperations": True,
    }

    try:
        preview_operations(document, operation_envelope)
    except ValidationError as error:
        assert "allowed node scope" in error.message
        return
    raise AssertionError("Expected ValidationError")


def test_reactflow_projection_keeps_view_model_separate_from_canonical_graph() -> None:
    document = load_document()
    view = to_reactflow_view(document)

    assert view["ok"] is True
    assert view["documentId"] == "doc_001"
    assert len(view["nodes"]) == 4
    assert len(view["edges"]) == 4
    assert "graph" not in view
    assert "metadata" not in view
    market_node = next(node for node in view["nodes"] if node["id"] == "market")
    assert market_node["type"] == "topicCard"
    assert market_node["data"]["nodeId"] == "market"
    assert market_node["data"]["title"] == "Market"
    assert market_node["position"] == {"x": 260, "y": 120}


def test_mcp_tool_list_exposes_v1_capability_surface() -> None:
    exposed_names = {tool["name"] for tool in TOOLS}

    assert exposed_names == {
        "mindmap_get_document_summary",
        "mindmap_get_node",
        "mindmap_get_neighbors",
        "mindmap_extract_subtree",
        "mindmap_compile_mermaid_context",
        "mindmap_preview_operations",
        "mindmap_apply_operations",
        "mindmap_render_reactflow_view",
        "mindmap_get_current_selection",
        "mindmap_build_context_from_selection",
        "mindmap_validate_document",
    }
    preview_schema = next(tool for tool in TOOLS if tool["name"] == "mindmap_preview_operations")["inputSchema"]
    assert preview_schema["required"] == ["documentPath", "operationEnvelope"]


def test_cli_returns_serialized_agent_context() -> None:
    completed = subprocess.run(
        [
            sys.executable,
            "-B",
            "-m",
            "mindmap_plugin.cli",
            "compile-mermaid-context",
            "--document",
            str(SAMPLE_DOCUMENT),
            "--start-node-id",
            "market",
            "--max-depth",
            "3",
        ],
        cwd=ROOT,
        env={"PYTHONPATH": str(ROOT / "src"), "PYTHONDONTWRITEBYTECODE": "1"},
        check=True,
        capture_output=True,
        text=True,
    )

    payload = json.loads(completed.stdout)
    assert payload["ok"] is True
    assert payload["projectionSupport"]["scope"] == {
        "type": "subtree",
        "rootNodeId": "market",
        "direction": "outgoing",
        "maxDepth": 3,
    }

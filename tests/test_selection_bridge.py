from __future__ import annotations

import json
import threading
from pathlib import Path
from urllib.request import Request, urlopen

from mindmap_plugin.tools import call_tool
from mindmap_plugin.webui import create_server

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_DOCUMENT = ROOT / "samples" / "documents" / "sample-mindmap.json"


def post_selection(url: str, token: str, node_ids: list[str], edge_ids: list[str] | None = None) -> None:
    request = Request(
        f"{url}/api/selection",
        data=json.dumps({"graphVersion": 7, "nodeIds": node_ids, "edgeIds": edge_ids or []}).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Mindmap-Token": token},
        method="POST",
    )
    with urlopen(request, timeout=5) as response:
        assert response.status == 200


def serve_with_runtime(tmp_path: Path):
    server = create_server(str(SAMPLE_DOCUMENT))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    runtime_path = tmp_path / "webui.json"
    runtime_path.write_text(
        json.dumps(
            {
                "url": f"http://{host}:{port}/?token={server.token}",
                "token": server.token,
                "documentPath": str(SAMPLE_DOCUMENT.resolve()),
            }
        ),
        encoding="utf-8",
    )
    return server, runtime_path


def test_get_current_selection_reads_running_webui_sidecar(tmp_path: Path) -> None:
    server, runtime_path = serve_with_runtime(tmp_path)
    try:
        host, port = server.server_address
        post_selection(f"http://{host}:{port}", server.token, ["market", "research"], ["edge_market_research"])

        result = call_tool(
            "get_current_selection",
            {"documentPath": str(SAMPLE_DOCUMENT), "runtimePath": str(runtime_path)},
        )

        assert result == {
            "ok": True,
            "documentId": "doc_001",
            "documentPath": str(SAMPLE_DOCUMENT.resolve()),
            "graphVersion": 7,
            "nodeIds": ["market", "research"],
            "edgeIds": ["edge_market_research"],
            "nodeCount": 2,
            "edgeCount": 1,
            "updatedAt": result["updatedAt"],
            "stale": False,
            "promptHint": "The user selected 2 nodes in the WebUI.",
            "source": {"type": "webui_selection"},
        }
        assert result["updatedAt"]
    finally:
        server.shutdown()
        server.server_close()


def test_build_context_from_selection_returns_mermaid_and_node_content(tmp_path: Path) -> None:
    server, runtime_path = serve_with_runtime(tmp_path)
    try:
        host, port = server.server_address
        post_selection(f"http://{host}:{port}", server.token, ["market", "research"])

        context = call_tool(
            "build_context_from_selection",
            {"documentPath": str(SAMPLE_DOCUMENT), "runtimePath": str(runtime_path)},
        )

        assert context["ok"] is True
        assert context["contextId"] == "ctx_webui_selection"
        assert context["documentId"] == "doc_001"
        assert context["graphVersion"] == 7
        assert context["promptHint"] == "The user selected 2 nodes in the WebUI."
        assert context["scope"] == {
            "type": "selection",
            "nodeIds": ["market", "research"],
            "edgeIds": [],
            "nodeCount": 2,
            "edgeCount": 0,
        }
        assert context["graph"] == {
            "nodeIds": ["market", "research"],
            "edgeIds": ["edge_market_research", "edge_research_market"],
        }
        assert context["includedNodeIds"] == ["market", "research"]
        assert context["includedEdgeIds"] == ["edge_market_research", "edge_research_market"]
        assert context["nodeContent"]["market"]["title"] == "Market"
        assert context["mermaid"]["included"] is True
        assert 'n_market["Market"]' in context["mermaid"]["text"]
        assert 'n_research["Research"]' in context["mermaid"]["text"]
        assert "graph" not in context["nodeContent"]["market"]
    finally:
        server.shutdown()
        server.server_close()

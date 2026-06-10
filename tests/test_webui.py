from __future__ import annotations

import json
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from mindmap_plugin.webui import create_server

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_DOCUMENT = ROOT / "samples" / "documents" / "sample-mindmap.json"


def read_url(url: str, token: str | None = None) -> tuple[int, dict]:
    headers = {"X-Mindmap-Token": token} if token else {}
    try:
        with urlopen(Request(url, headers=headers), timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        return error.status, json.loads(error.read().decode("utf-8"))


def post_json(url: str, payload: dict, token: str | None = None) -> tuple[int, dict]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Mindmap-Token"] = token
    request = Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        return error.status, json.loads(error.read().decode("utf-8"))


def serve_in_thread(document_path: Path, view_state_dir: Path | None = None):
    server = create_server(str(document_path), view_state_dir=view_state_dir)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def test_webui_uses_ephemeral_localhost_port() -> None:
    server = create_server(str(SAMPLE_DOCUMENT))
    try:
        host, port = server.server_address
        assert host == "127.0.0.1"
        assert port > 0
    finally:
        server.server_close()


def test_health_endpoint_returns_document_status() -> None:
    server, _ = serve_in_thread(SAMPLE_DOCUMENT)
    try:
        host, port = server.server_address
        status, payload = read_url(f"http://{host}:{port}/api/health")

        assert status == 200
        assert payload["ok"] is True
        assert payload["documentPath"] == str(SAMPLE_DOCUMENT.resolve())
        assert payload["documentId"] == "doc_001"
        assert payload["graphVersion"] == 7
        assert payload["viewStatePath"].endswith("doc_001.webui.json")
    finally:
        server.shutdown()
        server.server_close()


def test_graph_endpoint_returns_reactflow_projection_with_token(tmp_path: Path) -> None:
    before = SAMPLE_DOCUMENT.read_bytes()
    server, _ = serve_in_thread(SAMPLE_DOCUMENT, view_state_dir=tmp_path / "view-state")
    try:
        host, port = server.server_address
        status, payload = read_url(f"http://{host}:{port}/api/graph", token=server.token)

        assert status == 200
        assert payload["ok"] is True
        assert payload["graphVersion"] == 7
        assert payload["hasViewState"] is False
        assert payload["viewStateUpdatedAt"] is None
        assert len(payload["nodes"]) == 4
        assert len(payload["edges"]) == 4
        assert "graph" not in payload
        assert "metadata" not in payload
        assert SAMPLE_DOCUMENT.read_bytes() == before
    finally:
        server.shutdown()
        server.server_close()


def test_graph_endpoint_rejects_missing_token() -> None:
    server, _ = serve_in_thread(SAMPLE_DOCUMENT)
    try:
        host, port = server.server_address
        status, payload = read_url(f"http://{host}:{port}/api/graph")

        assert status == 401
        assert payload["ok"] is False
        assert payload["error"]["code"] == "UNAUTHORIZED"
    finally:
        server.shutdown()
        server.server_close()


def test_selection_endpoint_stores_valid_selection_without_mutating_document() -> None:
    before = SAMPLE_DOCUMENT.read_bytes()
    server, _ = serve_in_thread(SAMPLE_DOCUMENT)
    try:
        host, port = server.server_address
        status, payload = post_json(
            f"http://{host}:{port}/api/selection",
            {"graphVersion": 7, "nodeIds": ["market", "research"], "edgeIds": ["edge_market_research"]},
            token=server.token,
        )

        assert status == 200
        assert payload["ok"] is True
        assert payload["documentId"] == "doc_001"
        assert payload["graphVersion"] == 7
        assert payload["nodeIds"] == ["market", "research"]
        assert payload["edgeIds"] == ["edge_market_research"]
        assert payload["updatedAt"]
        assert payload["stale"] is False
        assert SAMPLE_DOCUMENT.read_bytes() == before

        status, current = read_url(f"http://{host}:{port}/api/selection", token=server.token)
        assert status == 200
        assert current["nodeIds"] == ["market", "research"]
    finally:
        server.shutdown()
        server.server_close()


def test_selection_endpoint_rejects_stale_or_unknown_selection() -> None:
    server, _ = serve_in_thread(SAMPLE_DOCUMENT)
    try:
        host, port = server.server_address
        status, payload = post_json(
            f"http://{host}:{port}/api/selection",
            {"graphVersion": 6, "nodeIds": ["market"], "edgeIds": []},
            token=server.token,
        )
        assert status == 409
        assert payload["error"]["code"] == "STALE_GRAPH_VERSION"

        status, payload = post_json(
            f"http://{host}:{port}/api/selection",
            {"graphVersion": 7, "nodeIds": ["missing"], "edgeIds": []},
            token=server.token,
        )
        assert status == 400
        assert payload["error"]["code"] == "INVALID_SELECTION"
    finally:
        server.shutdown()
        server.server_close()


def test_view_state_endpoint_persists_display_state_without_mutating_document(tmp_path: Path) -> None:
    before = SAMPLE_DOCUMENT.read_bytes()
    view_state_dir = tmp_path / "view-state"
    server, _ = serve_in_thread(SAMPLE_DOCUMENT, view_state_dir=view_state_dir)
    try:
        host, port = server.server_address
        status, payload = post_json(
            f"http://{host}:{port}/api/view-state",
            {
                "graphVersion": 7,
                "positions": {"market": {"x": 111, "y": 222}},
                "viewport": {"x": -50, "y": -80, "zoom": 1.25},
            },
            token=server.token,
        )

        assert status == 200
        assert payload["ok"] is True
        assert payload["documentId"] == "doc_001"
        assert payload["viewState"]["positions"] == {"market": {"x": 111.0, "y": 222.0}}
        assert payload["viewState"]["viewport"] == {"x": -50.0, "y": -80.0, "zoom": 1.25}
        assert payload["viewState"]["updatedAt"]
        assert SAMPLE_DOCUMENT.read_bytes() == before

        status, graph = read_url(f"http://{host}:{port}/api/graph", token=server.token)
        market = next(node for node in graph["nodes"] if node["id"] == "market")
        assert status == 200
        assert graph["hasViewState"] is True
        assert market["position"] == {"x": 111.0, "y": 222.0}
        assert graph["viewport"] == {"x": -50.0, "y": -80.0, "zoom": 1.25}
        assert SAMPLE_DOCUMENT.read_bytes() == before
    finally:
        server.shutdown()
        server.server_close()


def test_view_state_endpoint_rejects_canonical_or_invalid_updates(tmp_path: Path) -> None:
    server, _ = serve_in_thread(SAMPLE_DOCUMENT, view_state_dir=tmp_path / "view-state")
    try:
        host, port = server.server_address
        status, payload = post_json(
            f"http://{host}:{port}/api/view-state",
            {"graphVersion": 6, "positions": {"market": {"x": 1, "y": 2}}},
            token=server.token,
        )
        assert status == 409
        assert payload["error"]["code"] == "STALE_GRAPH_VERSION"

        status, payload = post_json(
            f"http://{host}:{port}/api/view-state",
            {"graphVersion": 7, "positions": {"missing": {"x": 1, "y": 2}}},
            token=server.token,
        )
        assert status == 400
        assert payload["error"]["code"] == "INVALID_VIEW_STATE"

        status, payload = post_json(
            f"http://{host}:{port}/api/view-state",
            {"graphVersion": 7, "nodes": {"market": {"title": "Changed"}}},
            token=server.token,
        )
        assert status == 400
        assert payload["error"]["code"] == "INVALID_VIEW_STATE"
    finally:
        server.shutdown()
        server.server_close()


def test_invalid_document_path_returns_structured_error() -> None:
    missing = ROOT / "samples" / "documents" / "missing.json"
    server, _ = serve_in_thread(missing)
    try:
        host, port = server.server_address
        status, payload = read_url(f"http://{host}:{port}/api/graph", token=server.token)

        assert status == 404
        assert payload["ok"] is False
        assert payload["error"]["code"] == "DOCUMENT_NOT_FOUND"
    finally:
        server.shutdown()
        server.server_close()

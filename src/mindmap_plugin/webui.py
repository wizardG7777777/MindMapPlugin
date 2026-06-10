from __future__ import annotations

import argparse
import json
import mimetypes
import secrets
import socketserver
import sys
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from math import isfinite
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .io import read_json
from .layout import to_reactflow_view

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STATIC_DIR = REPO_ROOT / "webui" / "dist"
DEFAULT_RUNTIME_PATH = REPO_ROOT / ".mindmap" / "runtime" / "webui.json"
DEFAULT_VIEW_STATE_DIR = REPO_ROOT / ".mindmap" / "view-state"


class WebUIError(Exception):
    def __init__(self, code: str, message: str, status: HTTPStatus = HTTPStatus.BAD_REQUEST) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status

    def to_payload(self) -> dict[str, Any]:
        return {"ok": False, "error": {"code": self.code, "message": self.message, "details": {}}}


def load_document(document_path: Path) -> dict[str, Any]:
    try:
        return read_json(str(document_path))
    except FileNotFoundError as error:
        raise WebUIError("DOCUMENT_NOT_FOUND", f"Document not found: {document_path}", HTTPStatus.NOT_FOUND) from error
    except json.JSONDecodeError as error:
        raise WebUIError("INVALID_JSON", f"Document is not valid JSON: {error}", HTTPStatus.BAD_REQUEST) from error


def document_identity(document_path: Path) -> tuple[dict[str, Any], str, int]:
    document = load_document(document_path)
    metadata = document.get("metadata", {})
    document_id = metadata.get("id")
    graph_version = metadata.get("graphVersion")
    if not isinstance(document_id, str) or not isinstance(graph_version, int):
        raise WebUIError("INVALID_DOCUMENT", "Document metadata must include id and graphVersion.", HTTPStatus.BAD_REQUEST)
    return document, document_id, graph_version


def safe_filename(value: str) -> str:
    safe = "".join(character if character.isalnum() or character in {"-", "_"} else "_" for character in value)
    return safe or "document"


def default_view_state(document_id: str) -> dict[str, Any]:
    return {
        "documentId": document_id,
        "viewId": "webui-default",
        "positions": {},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "updatedAt": None,
    }


def read_view_state(path: Path, document_id: str) -> dict[str, Any]:
    if not path.exists():
        return default_view_state(document_id)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise WebUIError("INVALID_VIEW_STATE", f"View-state file is not valid JSON: {error}", HTTPStatus.BAD_REQUEST) from error
    if not isinstance(payload, dict):
        raise WebUIError("INVALID_VIEW_STATE", "View-state file must contain a JSON object.", HTTPStatus.BAD_REQUEST)
    if payload.get("documentId") != document_id:
        return default_view_state(document_id)
    base = default_view_state(document_id)
    return {
        **base,
        "positions": payload.get("positions") if isinstance(payload.get("positions"), dict) else base["positions"],
        "viewport": payload.get("viewport") if isinstance(payload.get("viewport"), dict) else base["viewport"],
        "updatedAt": payload.get("updatedAt"),
    }


def write_json_file(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_graph_projection(document_path: Path, view_state_path: Path | None = None) -> dict[str, Any]:
    document, document_id, _ = document_identity(document_path)
    view_state = read_view_state(view_state_path, document_id) if view_state_path else None
    projection = to_reactflow_view(document, view_state=view_state)
    projection["hasViewState"] = bool(view_state and view_state.get("updatedAt"))
    projection["viewStateUpdatedAt"] = view_state.get("updatedAt") if view_state else None
    return projection


def write_runtime_info(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class MindMapWebUIServer(ThreadingHTTPServer):
    def server_bind(self) -> None:
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = str(host)
        self.server_port = int(port)

    def __init__(
        self,
        server_address: tuple[str, int],
        document_path: Path,
        static_dir: Path,
        view_state_dir: Path,
        token: str,
    ) -> None:
        super().__init__(server_address, MindMapWebUIRequestHandler)
        self.document_path = document_path
        self.static_dir = static_dir
        self.view_state_dir = view_state_dir
        self.token = token
        self.selection_lock = threading.Lock()
        self.selection: dict[str, Any] = {
            "nodeIds": [],
            "edgeIds": [],
            "updatedAt": None,
        }

    def view_state_path(self) -> Path:
        _, document_id, _ = document_identity(self.document_path)
        return self.view_state_dir / f"{safe_filename(document_id)}.webui.json"


class MindMapWebUIRequestHandler(BaseHTTPRequestHandler):
    server: MindMapWebUIServer

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("[mindmap-webui] " + format % args + "\n")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json(self.health_payload())
            return
        if parsed.path in {"/api/graph", "/api/selection", "/api/view-state"}:
            if not self.has_valid_token(parsed.query):
                self.send_json(
                    {"ok": False, "error": {"code": "UNAUTHORIZED", "message": "Invalid WebUI token.", "details": {}}},
                    HTTPStatus.UNAUTHORIZED,
                )
                return
        if parsed.path == "/api/graph":
            try:
                self.send_json(load_graph_projection(self.server.document_path, self.server.view_state_path()))
            except WebUIError as error:
                self.send_json(error.to_payload(), error.status)
            except Exception as error:
                self.send_json(
                    {
                        "ok": False,
                        "error": {"code": "UNEXPECTED_ERROR", "message": str(error), "details": {}},
                    },
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
            return
        if parsed.path == "/api/view-state":
            try:
                self.send_json(self.view_state_payload())
            except WebUIError as error:
                self.send_json(error.to_payload(), error.status)
            except Exception as error:
                self.send_json(
                    {
                        "ok": False,
                        "error": {"code": "UNEXPECTED_ERROR", "message": str(error), "details": {}},
                    },
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
            return
        if parsed.path == "/api/selection":
            try:
                self.send_json(self.selection_payload())
            except WebUIError as error:
                self.send_json(error.to_payload(), error.status)
            except Exception as error:
                self.send_json(
                    {
                        "ok": False,
                        "error": {"code": "UNEXPECTED_ERROR", "message": str(error), "details": {}},
                    },
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path not in {"/api/selection", "/api/view-state"}:
            self.send_json(
                {"ok": False, "error": {"code": "NOT_FOUND", "message": "Endpoint not found.", "details": {}}},
                HTTPStatus.NOT_FOUND,
            )
            return
        if not self.has_valid_token(parsed.query):
            self.send_json(
                {"ok": False, "error": {"code": "UNAUTHORIZED", "message": "Invalid WebUI token.", "details": {}}},
                HTTPStatus.UNAUTHORIZED,
            )
            return
        try:
            payload = self.read_json_body()
            if parsed.path == "/api/selection":
                self.update_selection(payload)
                self.send_json(self.selection_payload())
                return
            self.update_view_state(payload)
            self.send_json(self.view_state_payload())
        except WebUIError as error:
            self.send_json(error.to_payload(), error.status)
        except Exception as error:
            self.send_json(
                {
                    "ok": False,
                    "error": {"code": "UNEXPECTED_ERROR", "message": str(error), "details": {}},
                },
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise WebUIError("INVALID_REQUEST", "Request body must be a JSON object.", HTTPStatus.BAD_REQUEST)
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError as error:
            raise WebUIError("INVALID_JSON", f"Request body is not valid JSON: {error}", HTTPStatus.BAD_REQUEST) from error
        if not isinstance(payload, dict):
            raise WebUIError("INVALID_REQUEST", "Request body must be a JSON object.", HTTPStatus.BAD_REQUEST)
        return payload

    def health_payload(self) -> dict[str, Any]:
        try:
            projection = load_graph_projection(self.server.document_path, self.server.view_state_path())
            return {
                "ok": True,
                "documentPath": str(self.server.document_path),
                "documentId": projection["documentId"],
                "graphVersion": projection["graphVersion"],
                "viewStatePath": str(self.server.view_state_path()),
            }
        except WebUIError as error:
            return {**error.to_payload(), "documentPath": str(self.server.document_path)}

    def has_valid_token(self, query: str) -> bool:
        header_token = self.headers.get("X-Mindmap-Token")
        query_token = parse_qs(query).get("token", [None])[0]
        return secrets.compare_digest(header_token or query_token or "", self.server.token)

    def update_selection(self, payload: dict[str, Any]) -> None:
        projection = load_graph_projection(self.server.document_path, self.server.view_state_path())
        graph_version = payload.get("graphVersion")
        if graph_version != projection["graphVersion"]:
            raise WebUIError(
                "STALE_GRAPH_VERSION",
                "Selection graphVersion does not match the current document graphVersion.",
                HTTPStatus.CONFLICT,
            )

        node_ids = payload.get("nodeIds")
        edge_ids = payload.get("edgeIds", [])
        if not isinstance(node_ids, list) or not all(isinstance(node_id, str) for node_id in node_ids):
            raise WebUIError("INVALID_SELECTION", "nodeIds must be a list of strings.", HTTPStatus.BAD_REQUEST)
        if not isinstance(edge_ids, list) or not all(isinstance(edge_id, str) for edge_id in edge_ids):
            raise WebUIError("INVALID_SELECTION", "edgeIds must be a list of strings.", HTTPStatus.BAD_REQUEST)

        valid_node_ids = {node["id"] for node in projection["nodes"]}
        valid_edge_ids = {edge["id"] for edge in projection["edges"]}
        unknown_node_ids = sorted(set(node_ids) - valid_node_ids)
        unknown_edge_ids = sorted(set(edge_ids) - valid_edge_ids)
        if unknown_node_ids or unknown_edge_ids:
            raise WebUIError(
                "INVALID_SELECTION",
                "Selection references nodes or edges outside the current ReactFlow projection.",
                HTTPStatus.BAD_REQUEST,
            )

        with self.server.selection_lock:
            self.server.selection = {
                "nodeIds": list(dict.fromkeys(node_ids)),
                "edgeIds": list(dict.fromkeys(edge_ids)),
                "updatedAt": utc_now(),
            }

    def selection_payload(self) -> dict[str, Any]:
        projection = load_graph_projection(self.server.document_path, self.server.view_state_path())
        valid_node_ids = {node["id"] for node in projection["nodes"]}
        valid_edge_ids = {edge["id"] for edge in projection["edges"]}
        with self.server.selection_lock:
            selection = dict(self.server.selection)
        node_ids = [node_id for node_id in selection.get("nodeIds", []) if node_id in valid_node_ids]
        edge_ids = [edge_id for edge_id in selection.get("edgeIds", []) if edge_id in valid_edge_ids]
        stale = node_ids != selection.get("nodeIds", []) or edge_ids != selection.get("edgeIds", [])
        return {
            "ok": True,
            "documentPath": str(self.server.document_path),
            "documentId": projection["documentId"],
            "graphVersion": projection["graphVersion"],
            "nodeIds": node_ids,
            "edgeIds": edge_ids,
            "updatedAt": selection.get("updatedAt"),
            "stale": stale,
        }

    def view_state_payload(self) -> dict[str, Any]:
        _, document_id, graph_version = document_identity(self.server.document_path)
        view_state_path = self.server.view_state_path()
        view_state = read_view_state(view_state_path, document_id)
        return {
            "ok": True,
            "documentPath": str(self.server.document_path),
            "documentId": document_id,
            "graphVersion": graph_version,
            "viewStatePath": str(view_state_path),
            "viewState": view_state,
        }

    def update_view_state(self, payload: dict[str, Any]) -> None:
        projection = load_graph_projection(self.server.document_path, self.server.view_state_path())
        graph_version = payload.get("graphVersion")
        if graph_version != projection["graphVersion"]:
            raise WebUIError(
                "STALE_GRAPH_VERSION",
                "View-state graphVersion does not match the current document graphVersion.",
                HTTPStatus.CONFLICT,
            )

        positions = payload.get("positions")
        viewport = payload.get("viewport")
        if positions is None and viewport is None:
            raise WebUIError("INVALID_VIEW_STATE", "positions or viewport must be provided.", HTTPStatus.BAD_REQUEST)

        current = read_view_state(self.server.view_state_path(), projection["documentId"])
        next_view_state = {**current, "documentId": projection["documentId"], "viewId": "webui-default"}
        valid_node_ids = {node["id"] for node in projection["nodes"]}

        if positions is not None:
            next_view_state["positions"] = self.validate_positions(positions, valid_node_ids)
        if viewport is not None:
            next_view_state["viewport"] = self.validate_viewport(viewport)

        next_view_state["updatedAt"] = utc_now()
        write_json_file(self.server.view_state_path(), next_view_state)

    def validate_positions(self, positions: Any, valid_node_ids: set[str]) -> dict[str, dict[str, float]]:
        if not isinstance(positions, dict):
            raise WebUIError("INVALID_VIEW_STATE", "positions must be an object keyed by node id.", HTTPStatus.BAD_REQUEST)
        unknown_node_ids = sorted(set(positions) - valid_node_ids)
        if unknown_node_ids:
            raise WebUIError(
                "INVALID_VIEW_STATE",
                "positions references nodes outside the current ReactFlow projection.",
                HTTPStatus.BAD_REQUEST,
            )

        validated: dict[str, dict[str, float]] = {}
        for node_id, position in positions.items():
            if not isinstance(position, dict):
                raise WebUIError("INVALID_VIEW_STATE", "Each position must be an object.", HTTPStatus.BAD_REQUEST)
            x = position.get("x")
            y = position.get("y")
            if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not isfinite(x) or not isfinite(y):
                raise WebUIError("INVALID_VIEW_STATE", "Each position must include finite numeric x and y.", HTTPStatus.BAD_REQUEST)
            validated[node_id] = {"x": float(x), "y": float(y)}
        return validated

    def validate_viewport(self, viewport: Any) -> dict[str, float]:
        if not isinstance(viewport, dict):
            raise WebUIError("INVALID_VIEW_STATE", "viewport must be an object.", HTTPStatus.BAD_REQUEST)
        x = viewport.get("x")
        y = viewport.get("y")
        zoom = viewport.get("zoom")
        if (
            not isinstance(x, (int, float))
            or not isinstance(y, (int, float))
            or not isinstance(zoom, (int, float))
            or not isfinite(x)
            or not isfinite(y)
            or not isfinite(zoom)
            or zoom <= 0
        ):
            raise WebUIError("INVALID_VIEW_STATE", "viewport must include finite numeric x, y, and positive zoom.", HTTPStatus.BAD_REQUEST)
        return {"x": float(x), "y": float(y), "zoom": float(zoom)}

    def serve_static(self, request_path: str) -> None:
        if not self.server.static_dir.exists():
            self.send_json(
                {
                    "ok": False,
                    "error": {
                        "code": "WEBUI_NOT_BUILT",
                        "message": "WebUI static assets were not found. Run `npm install && npm run build` in webui/.",
                        "details": {"staticDir": str(self.server.static_dir)},
                    },
                },
                HTTPStatus.SERVICE_UNAVAILABLE,
            )
            return

        relative = request_path.lstrip("/") or "index.html"
        target = (self.server.static_dir / relative).resolve()
        static_root = self.server.static_dir.resolve()
        if not str(target).startswith(str(static_root)) or not target.exists() or target.is_dir():
            target = static_root / "index.html"
        self.send_file(target)

    def send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path) -> None:
        body = path.read_bytes()
        content_type, _ = mimetypes.guess_type(str(path))
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def create_server(
    document: str,
    host: str = "127.0.0.1",
    port: int = 0,
    static_dir: Path | None = None,
    view_state_dir: Path | None = None,
) -> MindMapWebUIServer:
    if host not in {"127.0.0.1", "localhost"}:
        raise WebUIError("INVALID_HOST", "WebUI v1 only supports localhost bindings.", HTTPStatus.BAD_REQUEST)
    token = secrets.token_urlsafe(24)
    return MindMapWebUIServer(
        (host, port),
        Path(document).expanduser().resolve(),
        static_dir or DEFAULT_STATIC_DIR,
        view_state_dir or DEFAULT_VIEW_STATE_DIR,
        token,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mindmap-webui", description="Serve the Mind Map ReactFlow WebUI.")
    parser.add_argument("--document", required=True, help="Path to a canonical graph JSON document.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind. Defaults to 127.0.0.1.")
    parser.add_argument("--port", type=int, default=0, help="Port to bind. Defaults to 0 for an ephemeral port.")
    parser.add_argument("--static-dir", type=Path, default=DEFAULT_STATIC_DIR, help="Built WebUI static asset directory.")
    parser.add_argument("--runtime-path", type=Path, default=DEFAULT_RUNTIME_PATH, help="Path for runtime WebUI metadata.")
    parser.add_argument("--view-state-dir", type=Path, default=DEFAULT_VIEW_STATE_DIR, help="Directory for WebUI presentation state.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        server = create_server(
            args.document,
            host=args.host,
            port=args.port,
            static_dir=args.static_dir,
            view_state_dir=args.view_state_dir,
        )
    except WebUIError as error:
        print(json.dumps(error.to_payload(), ensure_ascii=False, indent=2), file=sys.stderr)
        return 1

    host, port = server.server_address
    url = f"http://{host}:{port}/?token={server.token}"
    runtime_info = {
        "host": host,
        "port": port,
        "url": url,
        "token": server.token,
        "documentPath": str(server.document_path),
        "viewStatePath": str(server.view_state_path()),
        "startedAt": datetime.now(timezone.utc).isoformat(),
    }
    write_runtime_info(args.runtime_path, runtime_info)
    print(url, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

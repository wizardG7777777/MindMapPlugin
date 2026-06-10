from __future__ import annotations

import json
import sys
from typing import Any

from .errors import MindMapError
from .tools import call_tool


def read_message() -> dict[str, Any] | None:
    headers: dict[str, str] = {}
    while True:
        line = sys.stdin.buffer.readline()
        if line == b"":
            return None
        line = line.decode("utf-8").strip()
        if not line:
            break
        key, _, value = line.partition(":")
        headers[key.lower()] = value.strip()
    length = int(headers.get("content-length", "0"))
    if length <= 0:
        return None
    body = sys.stdin.buffer.read(length)
    return json.loads(body.decode("utf-8"))


def write_message(message: dict[str, Any]) -> None:
    body = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(f"Content-Length: {len(body)}\r\n\r\n".encode("ascii"))
    sys.stdout.buffer.write(body)
    sys.stdout.buffer.flush()


def tool_schema(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "name": f"mindmap_{name}",
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": {
                "documentPath": {
                    "type": "string",
                    "description": "Path to the canonical graph JSON document.",
                },
                **properties,
            },
            "required": ["documentPath", *required],
            "additionalProperties": False,
        },
    }


TOOLS = [
    tool_schema("get_document_summary", "Read document metadata and compact graph summary.", {}, []),
    tool_schema(
        "get_node",
        "Read one canonical node by id.",
        {"nodeId": {"type": "string"}},
        ["nodeId"],
    ),
    tool_schema(
        "get_neighbors",
        "Read incoming and/or outgoing relationships around one node.",
        {
            "nodeId": {"type": "string"},
            "direction": {"type": "string", "enum": ["incoming", "outgoing", "both"], "default": "both"},
        },
        ["nodeId"],
    ),
    tool_schema(
        "extract_subtree",
        "Extract a focused acyclic projection with cycle/repeated markers.",
        {
            "startNodeId": {"type": "string"},
            "direction": {"type": "string", "enum": ["incoming", "outgoing", "both"], "default": "outgoing"},
            "maxDepth": {"type": "integer", "default": 3, "minimum": 0},
            "cyclePolicy": {"type": "string", "enum": ["mark"], "default": "mark"},
        },
        ["startNodeId"],
    ),
    tool_schema(
        "compile_mermaid_context",
        "Compile a graph or focused projection into Mermaid plus projection support data.",
        {
            "startNodeId": {"type": "string"},
            "direction": {"type": "string", "enum": ["incoming", "outgoing", "both"], "default": "outgoing"},
            "maxDepth": {"type": "integer", "default": 3, "minimum": 0},
            "orientation": {"type": "string", "enum": ["LR", "TD"], "default": "LR"},
            "includeEdgeKinds": {"type": "boolean", "default": True},
            "includeNodeContent": {"type": "string", "enum": ["none", "card", "notes"], "default": "card"},
            "maxNodes": {"type": "integer", "minimum": 1},
            "maxEdges": {"type": "integer", "minimum": 1},
        },
        [],
    ),
    tool_schema(
        "preview_operations",
        "Validate and preview a GraphOperation envelope without writing the document.",
        {"operationEnvelope": {"type": "object"}},
        ["operationEnvelope"],
    ),
    tool_schema(
        "apply_operations",
        "Apply a validated GraphOperation envelope and save the next graphVersion.",
        {
            "operationEnvelope": {"type": "object"},
            "outputPath": {"type": "string"},
        },
        ["operationEnvelope"],
    ),
    tool_schema(
        "render_reactflow_view",
        "Project canonical graph data into ReactFlow-compatible nodes and edges.",
        {"viewStatePath": {"type": "string"}},
        [],
    ),
    tool_schema(
        "get_current_selection",
        "Read the current WebUI selection from the running local sidecar.",
        {"runtimePath": {"type": "string"}},
        [],
    ),
    tool_schema(
        "build_context_from_selection",
        "Build an agent context packet from the current WebUI selection.",
        {
            "runtimePath": {"type": "string"},
            "purpose": {"type": "string", "default": "webui_selection_context"},
            "orientation": {"type": "string", "enum": ["LR", "TD"], "default": "LR"},
            "includeEdgeKinds": {"type": "boolean", "default": True},
            "includeNodeContent": {"type": "string", "enum": ["none", "card", "notes"], "default": "card"},
        },
        [],
    ),
    tool_schema("validate_document", "Validate canonical graph invariants.", {}, []),
]

TOOL_NAME_MAP = {tool["name"]: tool["name"].replace("mindmap_", "", 1) for tool in TOOLS}


def response(request_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def error_response(request_id: Any, code: int, message: str, data: Any = None) -> dict[str, Any]:
    error = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": request_id, "error": error}


def handle(request: dict[str, Any]) -> dict[str, Any] | None:
    method = request.get("method")
    request_id = request.get("id")
    if method == "initialize":
        return response(
            request_id,
            {
                "protocolVersion": request.get("params", {}).get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "mind-map", "version": "0.1.0"},
            },
        )
    if method == "notifications/initialized":
        return None
    if method == "tools/list":
        return response(request_id, {"tools": TOOLS})
    if method == "tools/call":
        params = request.get("params") or {}
        tool_name = params.get("name")
        arguments = params.get("arguments") or {}
        internal_name = TOOL_NAME_MAP.get(tool_name)
        if not internal_name:
            return error_response(request_id, -32602, f"Unknown tool: {tool_name}")
        try:
            result = call_tool(internal_name, arguments)
            return response(
                request_id,
                {
                    "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}],
                    "isError": False,
                },
            )
        except MindMapError as error:
            return response(
                request_id,
                {
                    "content": [{"type": "text", "text": json.dumps(error.to_dict(), ensure_ascii=False, indent=2)}],
                    "isError": True,
                },
            )
        except Exception as error:
            return response(
                request_id,
                {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(
                                {"ok": False, "error": {"code": "UNEXPECTED_ERROR", "message": str(error), "details": {}}},
                                ensure_ascii=False,
                                indent=2,
                            ),
                        }
                    ],
                    "isError": True,
                },
            )
    return error_response(request_id, -32601, f"Method not found: {method}")


def main() -> int:
    while True:
        message = read_message()
        if message is None:
            return 0
        result = handle(message)
        if result is not None:
            write_message(result)


if __name__ == "__main__":
    raise SystemExit(main())

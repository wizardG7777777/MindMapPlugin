from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .errors import ToolInputError
from .graph_core import apply_operations, get_neighbors, get_node, preview_operations, summarize_document, validate_document
from .io import read_json, write_json
from .layout import to_reactflow_view
from .mermaid import compile_document_to_mermaid_context, compile_projection_to_mermaid
from .projections import extract_subtree, selection_projection
from .webui import DEFAULT_RUNTIME_PATH

ToolHandler = Callable[[dict[str, Any]], dict[str, Any]]


def _document(arguments: dict[str, Any]) -> dict[str, Any]:
    path = arguments.get("documentPath")
    if not path:
        raise ValueError("documentPath is required.")
    return read_json(path)


def tool_get_document_summary(arguments: dict[str, Any]) -> dict[str, Any]:
    document = _document(arguments)
    return {"ok": True, **summarize_document(document)}


def tool_get_node(arguments: dict[str, Any]) -> dict[str, Any]:
    document = _document(arguments)
    return {"ok": True, "node": get_node(document, arguments["nodeId"])}


def tool_get_neighbors(arguments: dict[str, Any]) -> dict[str, Any]:
    document = _document(arguments)
    return {"ok": True, **get_neighbors(document, arguments["nodeId"], arguments.get("direction", "both"))}


def tool_extract_subtree(arguments: dict[str, Any]) -> dict[str, Any]:
    document = _document(arguments)
    return {
        "ok": True,
        "projection": extract_subtree(
            document,
            arguments["startNodeId"],
            direction=arguments.get("direction", "outgoing"),
            max_depth=int(arguments.get("maxDepth", 3)),
            cycle_policy=arguments.get("cyclePolicy", "mark"),
        ),
    }


def tool_compile_mermaid_context(arguments: dict[str, Any]) -> dict[str, Any]:
    document = _document(arguments)
    return compile_document_to_mermaid_context(
        document,
        start_node_id=arguments.get("startNodeId"),
        direction=arguments.get("direction", "outgoing"),
        max_depth=int(arguments.get("maxDepth", 3)),
        orientation=arguments.get("orientation", "LR"),
        include_edge_kinds=arguments.get("includeEdgeKinds", True),
        include_node_content=arguments.get("includeNodeContent", "card"),
        max_nodes=arguments.get("maxNodes"),
        max_edges=arguments.get("maxEdges"),
    )


def tool_preview_operations(arguments: dict[str, Any]) -> dict[str, Any]:
    document = _document(arguments)
    envelope = arguments.get("operationEnvelope")
    if not isinstance(envelope, dict):
        raise ValueError("operationEnvelope is required.")
    return preview_operations(document, envelope)


def tool_apply_operations(arguments: dict[str, Any]) -> dict[str, Any]:
    document_path = arguments.get("documentPath")
    document = _document(arguments)
    envelope = arguments.get("operationEnvelope")
    if not isinstance(envelope, dict):
        raise ValueError("operationEnvelope is required.")
    updated, result = apply_operations(document, envelope)
    output_path = arguments.get("outputPath") or document_path
    write_json(output_path, updated)
    return {**result, "outputPath": output_path}


def tool_render_reactflow_view(arguments: dict[str, Any]) -> dict[str, Any]:
    document = _document(arguments)
    view_state = read_json(arguments["viewStatePath"]) if arguments.get("viewStatePath") else None
    return to_reactflow_view(document, view_state=view_state)


def _runtime_info(arguments: dict[str, Any]) -> dict[str, Any]:
    runtime_path = Path(arguments.get("runtimePath") or DEFAULT_RUNTIME_PATH).expanduser()
    try:
        runtime = read_json(str(runtime_path))
    except FileNotFoundError as error:
        raise ToolInputError(
            "WebUI runtime metadata was not found. Start the WebUI first.",
            {"runtimePath": str(runtime_path)},
        ) from error
    if not isinstance(runtime, dict) or not runtime.get("url") or not runtime.get("token"):
        raise ToolInputError("WebUI runtime metadata is invalid.", {"runtimePath": str(runtime_path)})
    return runtime


def _webui_api_url(runtime: dict[str, Any], path: str) -> str:
    parsed = urlparse(runtime["url"])
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ToolInputError("WebUI runtime URL is invalid.", {"url": runtime.get("url")})
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def _fetch_webui_selection(arguments: dict[str, Any]) -> dict[str, Any]:
    runtime = _runtime_info(arguments)
    request = Request(_webui_api_url(runtime, "/api/selection"), headers={"X-Mindmap-Token": str(runtime["token"])})
    try:
        with urlopen(request, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        details = json.loads(error.read().decode("utf-8"))
        raise ToolInputError("WebUI selection endpoint returned an error.", details) from error
    except URLError as error:
        raise ToolInputError("WebUI sidecar is not reachable.", {"reason": str(error)}) from error
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise ToolInputError("WebUI selection endpoint returned an invalid payload.", {"payload": payload})
    return payload


def _assert_selection_matches_document(selection: dict[str, Any], document: dict[str, Any], document_path: str | None) -> None:
    validate_document(document)
    if selection.get("documentId") != document["metadata"]["id"]:
        raise ToolInputError(
            "WebUI selection belongs to a different document.",
            {"selectionDocumentId": selection.get("documentId"), "documentId": document["metadata"]["id"]},
        )
    if selection.get("graphVersion") != document["metadata"]["graphVersion"]:
        raise ToolInputError(
            "WebUI selection graphVersion is stale for the current document.",
            {"selectionGraphVersion": selection.get("graphVersion"), "graphVersion": document["metadata"]["graphVersion"]},
        )
    if document_path:
        expected = str(Path(document_path).expanduser().resolve())
        if selection.get("documentPath") != expected:
            raise ToolInputError(
                "WebUI selection path does not match documentPath.",
                {"selectionDocumentPath": selection.get("documentPath"), "documentPath": expected},
            )


def tool_get_current_selection(arguments: dict[str, Any]) -> dict[str, Any]:
    document = _document(arguments)
    selection = _fetch_webui_selection(arguments)
    _assert_selection_matches_document(selection, document, arguments.get("documentPath"))
    node_count = len(selection["nodeIds"])
    edge_count = len(selection["edgeIds"])
    return {
        "ok": True,
        "documentId": selection["documentId"],
        "documentPath": selection["documentPath"],
        "graphVersion": selection["graphVersion"],
        "nodeIds": selection["nodeIds"],
        "edgeIds": selection["edgeIds"],
        "nodeCount": node_count,
        "edgeCount": edge_count,
        "updatedAt": selection["updatedAt"],
        "stale": selection["stale"],
        "promptHint": f"The user selected {node_count} node{'s' if node_count != 1 else ''} in the WebUI.",
        "source": {"type": "webui_selection"},
    }


def tool_build_context_from_selection(arguments: dict[str, Any]) -> dict[str, Any]:
    document = _document(arguments)
    selection = _fetch_webui_selection(arguments)
    _assert_selection_matches_document(selection, document, arguments.get("documentPath"))
    projection = selection_projection(document, selection["nodeIds"], selection["edgeIds"])
    node_count = len(selection["nodeIds"])
    edge_count = len(selection["edgeIds"])
    compiled = compile_projection_to_mermaid(
        projection,
        orientation=arguments.get("orientation", "LR"),
        include_edge_kinds=arguments.get("includeEdgeKinds", True),
        include_node_content=arguments.get("includeNodeContent", "card"),
    )
    return {
        "ok": True,
        "contextId": "ctx_webui_selection",
        "purpose": arguments.get("purpose", "webui_selection_context"),
        "documentId": document["metadata"]["id"],
        "documentPath": str(Path(arguments["documentPath"]).expanduser().resolve()),
        "graphVersion": document["metadata"]["graphVersion"],
        "source": {
            "type": "webui_selection",
            "updatedAt": selection.get("updatedAt"),
            "stale": selection.get("stale", False),
        },
        "promptHint": f"The user selected {node_count} node{'s' if node_count != 1 else ''} in the WebUI.",
        "scope": {
            "type": "selection",
            "nodeIds": selection["nodeIds"],
            "edgeIds": selection["edgeIds"],
            "nodeCount": node_count,
            "edgeCount": edge_count,
        },
        "graph": {
            "nodeIds": compiled["includedNodeIds"],
            "edgeIds": compiled["includedEdgeIds"],
        },
        "includedNodeIds": compiled["includedNodeIds"],
        "includedEdgeIds": compiled["includedEdgeIds"],
        "nodeContent": compiled["nodeContent"],
        "mermaid": {
            "included": True,
            "text": compiled["mermaid"],
        },
        "projectionSupport": compiled["projectionSupport"],
        "omissions": compiled["projectionSupport"]["omissions"],
    }


def tool_validate_document(arguments: dict[str, Any]) -> dict[str, Any]:
    document = _document(arguments)
    validate_document(document)
    return {"ok": True, **summarize_document(document)}


TOOL_REGISTRY: dict[str, ToolHandler] = {
    "get_document_summary": tool_get_document_summary,
    "get_node": tool_get_node,
    "get_neighbors": tool_get_neighbors,
    "extract_subtree": tool_extract_subtree,
    "compile_mermaid_context": tool_compile_mermaid_context,
    "preview_operations": tool_preview_operations,
    "apply_operations": tool_apply_operations,
    "render_reactflow_view": tool_render_reactflow_view,
    "get_current_selection": tool_get_current_selection,
    "build_context_from_selection": tool_build_context_from_selection,
    "validate_document": tool_validate_document,
}


def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if name not in TOOL_REGISTRY:
        raise ValueError(f"Unknown tool: {name}")
    return TOOL_REGISTRY[name](arguments)

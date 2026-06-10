from __future__ import annotations

import re
from typing import Any

from .graph_core import sorted_edges, validate_document
from .projections import extract_subtree, full_projection


def sanitize_identifier(value: str) -> str:
    sanitized = re.sub(r"[^A-Za-z0-9_]", "_", value)
    sanitized = re.sub(r"_+", "_", sanitized).strip("_")
    if not sanitized:
        sanitized = "id"
    if sanitized[0].isdigit():
        sanitized = f"id_{sanitized}"
    return f"n_{sanitized}"


def escape_label(value: str) -> str:
    return " ".join(str(value).replace("\\", "\\\\").replace('"', '\\"').splitlines()).strip()


def unique_mermaid_ids(node_ids: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    used: dict[str, int] = {}
    for node_id in node_ids:
        base = sanitize_identifier(node_id)
        count = used.get(base, 0)
        used[base] = count + 1
        result[node_id] = base if count == 0 else f"{base}_{count}"
    return result


def edge_label(edge: dict[str, Any], include_edge_kinds: bool = True) -> str:
    parts = []
    if include_edge_kinds:
        parts.append(edge.get("kind", "contains"))
    if "order" in edge:
        parts.append(f"order={edge['order']}")
    if edge.get("marker"):
        parts.append(edge["marker"])
    return " ".join(parts)


def compile_projection_to_mermaid(
    projection: dict[str, Any],
    orientation: str = "LR",
    include_edge_kinds: bool = True,
    include_node_content: str = "card",
) -> dict[str, Any]:
    if orientation not in {"LR", "TD"}:
        orientation = "LR"

    nodes = projection["nodes"]
    edges = projection["edges"]
    node_ids = sorted(nodes)
    mermaid_ids = unique_mermaid_ids(node_ids)
    lines = [f"flowchart {orientation}"]
    projection_nodes: dict[str, dict[str, Any]] = {}

    for node_id in node_ids:
        mermaid_id = mermaid_ids[node_id]
        label = escape_label(nodes[node_id]["title"])
        lines.append(f'  {mermaid_id}["{label}"]')
        projection_nodes[mermaid_id] = {"nodeId": node_id}

    if edges:
        lines.append("")

    projection_edges: dict[str, dict[str, Any]] = {}
    for index, edge in enumerate(sorted_edges(edges)):
        source = mermaid_ids[edge["source"]]
        target = mermaid_ids[edge["target"]]
        label = edge_label(edge, include_edge_kinds)
        line = f"  {source} --> {target}" if not label else f'  {source} -->|"{escape_label(label)}"| {target}'
        lines.append(line)
        projection_edge_id = f"p_{index}_{re.sub(r'[^A-Za-z0-9_]', '_', edge['id'])}"
        projection_edges[projection_edge_id] = {
            "edgeId": edge["id"],
            "source": edge["source"],
            "target": edge["target"],
            "kind": edge.get("kind", "contains"),
            **({"order": edge["order"]} if "order" in edge else {}),
            **({"marker": edge["marker"]} if edge.get("marker") else {}),
        }

    node_content = {}
    for node_id in node_ids:
        node = nodes[node_id]
        content = {"title": node["title"]}
        if include_node_content in {"card", "notes"}:
            content["cardContent"] = node.get("cardContent", "")
        if include_node_content == "notes":
            content["notes"] = node.get("notes", "")
        elif node.get("notes"):
            content["notesOmitted"] = True
        node_content[node_id] = content

    return {
        "mermaid": "\n".join(lines),
        "includedNodeIds": projection.get("includedNodeIds", node_ids),
        "includedEdgeIds": projection.get("includedEdgeIds", [edge["id"] for edge in sorted_edges(edges)]),
        "projectionSupport": {
            "nodes": projection_nodes,
            "edges": projection_edges,
            "markers": projection.get("markers", []),
            "scope": {
                "type": projection.get("type"),
                "rootNodeId": projection.get("rootNodeId"),
                "direction": projection.get("direction"),
                "maxDepth": projection.get("maxDepth"),
            },
            "omissions": projection.get("omissions", {}),
        },
        "nodeContent": node_content,
    }


def compile_document_to_mermaid_context(
    document: dict[str, Any],
    start_node_id: str | None = None,
    direction: str = "outgoing",
    max_depth: int = 3,
    orientation: str = "LR",
    include_edge_kinds: bool = True,
    include_node_content: str = "card",
    max_nodes: int | None = None,
    max_edges: int | None = None,
) -> dict[str, Any]:
    validate_document(document)
    if start_node_id:
        projection = extract_subtree(document, start_node_id, direction=direction, max_depth=max_depth)
    else:
        projection = full_projection(document, max_nodes=max_nodes, max_edges=max_edges)
    result = compile_projection_to_mermaid(
        projection,
        orientation=orientation,
        include_edge_kinds=include_edge_kinds,
        include_node_content=include_node_content,
    )
    return {
        "ok": True,
        "documentId": document["metadata"]["id"],
        "graphVersion": document["metadata"]["graphVersion"],
        **result,
    }

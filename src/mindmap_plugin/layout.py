from __future__ import annotations

from typing import Any

from .graph_core import sorted_edges, validate_document


def estimate_dimensions(node: dict[str, Any]) -> dict[str, int]:
    title_width = max(120, min(320, len(node.get("title", "")) * 9 + 48))
    card_lines = max(1, (len(node.get("cardContent", "")) // 38) + 1) if node.get("cardContent") else 1
    return {"width": title_width, "height": 48 + card_lines * 20}


def calculate_positions(document: dict[str, Any]) -> dict[str, dict[str, int]]:
    graph = document["graph"]
    positions: dict[str, dict[str, int]] = {}
    children: dict[str, list[str]] = {}
    for edge in sorted_edges(graph["edges"]):
        if edge.get("kind") == "contains":
            children.setdefault(edge["source"], []).append(edge["target"])

    visited: set[str] = set()
    row = 0

    def place(node_id: str, depth: int) -> None:
        nonlocal row
        if node_id in visited:
            return
        visited.add(node_id)
        current_row = row
        row += 1
        positions[node_id] = {"x": depth * 260, "y": current_row * 120}
        for child_id in children.get(node_id, []):
            place(child_id, depth + 1)

    place(graph["entryNodeId"], 0)
    for node_id in sorted(graph["nodes"]):
        if node_id not in positions:
            place(node_id, 0)
    return positions


def to_reactflow_view(document: dict[str, Any], view_state: dict[str, Any] | None = None) -> dict[str, Any]:
    validate_document(document)
    graph = document["graph"]
    view_state = view_state or {}
    positions = {**calculate_positions(document), **(view_state.get("positions") or {})}
    dimensions = view_state.get("dimensions") or {}
    collapsed = set(view_state.get("collapsed") or [])
    hidden_nodes: set[str] = set()
    for edge in sorted_edges(graph["edges"]):
        if edge["source"] in collapsed and edge.get("kind") == "contains":
            hidden_nodes.add(edge["target"])

    nodes = []
    for node_id in sorted(graph["nodes"]):
        if node_id in hidden_nodes:
            continue
        node = graph["nodes"][node_id]
        size = dimensions.get(node_id) or estimate_dimensions(node)
        nodes.append(
            {
                "id": node_id,
                "type": "topicCard",
                "position": positions[node_id],
                "data": {
                    "nodeId": node_id,
                    "title": node["title"],
                    "cardContent": node.get("cardContent", ""),
                    "notes": node.get("notes", ""),
                    "meta": node.get("meta", {}),
                    "diagramKind": graph["diagramKind"],
                },
                **size,
            }
        )

    edges = []
    for edge in sorted_edges(graph["edges"]):
        if edge["source"] in hidden_nodes or edge["target"] in hidden_nodes:
            continue
        edges.append(
            {
                "id": edge["id"],
                "source": edge["source"],
                "target": edge["target"],
                "type": "smoothstep" if edge.get("kind") == "contains" else "dashedReference",
                "label": edge.get("kind", "contains"),
                "data": {
                    "edgeId": edge["id"],
                    "kind": edge.get("kind", "contains"),
                    "order": edge.get("order"),
                    "meta": edge.get("meta", {}),
                },
            }
        )

    return {
        "ok": True,
        "documentId": document["metadata"]["id"],
        "graphVersion": document["metadata"]["graphVersion"],
        "nodes": nodes,
        "edges": edges,
        "viewport": view_state.get("viewport", {"x": 0, "y": 0, "zoom": 1}),
    }

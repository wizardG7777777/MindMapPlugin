from __future__ import annotations

import copy
from typing import Any

from .errors import ToolInputError
from .graph_core import sorted_edges, validate_document


def edge_sort_key(edge: dict[str, Any]) -> tuple:
    return (
        edge.get("kind", ""),
        edge.get("order", 10**9),
        edge.get("id", ""),
        edge.get("target", ""),
        edge.get("source", ""),
    )


def extract_subtree(
    document: dict[str, Any],
    start_node_id: str,
    direction: str = "outgoing",
    max_depth: int = 3,
    cycle_policy: str = "mark",
) -> dict[str, Any]:
    validate_document(document)
    if start_node_id not in document["graph"]["nodes"]:
        raise ToolInputError("startNodeId does not exist.", {"startNodeId": start_node_id})
    if direction not in {"outgoing", "incoming", "both"}:
        raise ToolInputError("direction must be outgoing, incoming, or both.", {"direction": direction})
    if cycle_policy != "mark":
        raise ToolInputError("Only cyclePolicy=mark is supported in v1.", {"cyclePolicy": cycle_policy})
    if max_depth < 0:
        raise ToolInputError("maxDepth must be >= 0.", {"maxDepth": max_depth})

    graph = document["graph"]
    nodes = graph["nodes"]
    edges = graph["edges"]
    included_nodes: dict[str, dict[str, Any]] = {}
    included_edges: dict[str, dict[str, Any]] = {}
    markers: list[dict[str, Any]] = []
    emitted_nodes: set[str] = set()

    def outgoing_edges(node_id: str) -> list[dict[str, Any]]:
        return sorted([edge for edge in edges.values() if edge["source"] == node_id], key=edge_sort_key)

    def incoming_edges(node_id: str) -> list[dict[str, Any]]:
        return sorted([edge for edge in edges.values() if edge["target"] == node_id], key=edge_sort_key)

    def neighbor_for(edge: dict[str, Any], current_node_id: str) -> str:
        if edge["source"] == current_node_id:
            return edge["target"]
        return edge["source"]

    def selectable_edges(node_id: str) -> list[dict[str, Any]]:
        selected = []
        if direction in {"outgoing", "both"}:
            selected.extend(outgoing_edges(node_id))
        if direction in {"incoming", "both"}:
            selected.extend(incoming_edges(node_id))
        return sorted({edge["id"]: edge for edge in selected}.values(), key=edge_sort_key)

    def visit(node_id: str, depth: int, path: list[str]) -> None:
        included_nodes[node_id] = copy.deepcopy(nodes[node_id])
        emitted_nodes.add(node_id)
        if depth >= max_depth:
            return
        for edge in selectable_edges(node_id):
            next_node_id = neighbor_for(edge, node_id)
            marker = None
            if next_node_id in path:
                marker = "cycle"
            elif next_node_id in emitted_nodes:
                marker = "repeated"

            projection_edge = copy.deepcopy(edge)
            if marker:
                projection_edge["marker"] = marker
                markers.append(
                    {
                        "edgeId": edge["id"],
                        "source": edge["source"],
                        "target": edge["target"],
                        "marker": marker,
                    }
                )
            included_edges[edge["id"]] = projection_edge
            included_nodes[next_node_id] = copy.deepcopy(nodes[next_node_id])
            if not marker:
                visit(next_node_id, depth + 1, [*path, next_node_id])

    visit(start_node_id, 0, [start_node_id])
    return {
        "type": "subtree",
        "documentId": document["metadata"]["id"],
        "graphVersion": document["metadata"]["graphVersion"],
        "rootNodeId": start_node_id,
        "direction": direction,
        "maxDepth": max_depth,
        "nodes": included_nodes,
        "edges": included_edges,
        "includedNodeIds": sorted(included_nodes),
        "includedEdgeIds": [edge["id"] for edge in sorted_edges(included_edges)],
        "markers": markers,
        "omissions": {
            "maxDepthReached": max_depth,
        },
    }


def full_projection(document: dict[str, Any], max_nodes: int | None = None, max_edges: int | None = None) -> dict[str, Any]:
    validate_document(document)
    graph = document["graph"]
    node_ids = sorted(graph["nodes"])
    edge_values = sorted_edges(graph["edges"])
    omitted_nodes = 0
    omitted_edges = 0
    if max_nodes is not None and len(node_ids) > max_nodes:
        omitted_nodes = len(node_ids) - max_nodes
        node_ids = node_ids[:max_nodes]
    node_set = set(node_ids)
    filtered_edges = [edge for edge in edge_values if edge["source"] in node_set and edge["target"] in node_set]
    if max_edges is not None and len(filtered_edges) > max_edges:
        omitted_edges = len(filtered_edges) - max_edges
        filtered_edges = filtered_edges[:max_edges]
    return {
        "type": "full",
        "documentId": document["metadata"]["id"],
        "graphVersion": document["metadata"]["graphVersion"],
        "rootNodeId": graph["entryNodeId"],
        "nodes": {node_id: copy.deepcopy(graph["nodes"][node_id]) for node_id in node_ids},
        "edges": {edge["id"]: copy.deepcopy(edge) for edge in filtered_edges},
        "includedNodeIds": node_ids,
        "includedEdgeIds": [edge["id"] for edge in filtered_edges],
        "markers": [],
        "omissions": {
            "omittedNodeCount": omitted_nodes,
            "omittedEdgeCount": omitted_edges,
        },
    }


def selection_projection(document: dict[str, Any], node_ids: list[str], edge_ids: list[str] | None = None) -> dict[str, Any]:
    validate_document(document)
    graph = document["graph"]
    edge_ids = edge_ids or []
    ordered_node_ids = list(dict.fromkeys(node_ids))
    ordered_edge_ids = list(dict.fromkeys(edge_ids))

    unknown_node_ids = sorted(set(ordered_node_ids) - set(graph["nodes"]))
    unknown_edge_ids = sorted(set(ordered_edge_ids) - set(graph["edges"]))
    if unknown_node_ids or unknown_edge_ids:
        raise ToolInputError(
            "Selection references nodes or edges outside the canonical graph.",
            {"nodeIds": unknown_node_ids, "edgeIds": unknown_edge_ids},
        )

    included_node_ids = set(ordered_node_ids)
    included_edges: dict[str, dict[str, Any]] = {}
    for edge_id in ordered_edge_ids:
        edge = graph["edges"][edge_id]
        included_edges[edge_id] = copy.deepcopy(edge)
        included_node_ids.add(edge["source"])
        included_node_ids.add(edge["target"])

    selected_node_set = set(ordered_node_ids)
    for edge in sorted_edges(graph["edges"]):
        if edge["source"] in selected_node_set and edge["target"] in selected_node_set:
            included_edges[edge["id"]] = copy.deepcopy(edge)

    sorted_node_ids = sorted(included_node_ids)
    return {
        "type": "selection",
        "documentId": document["metadata"]["id"],
        "graphVersion": document["metadata"]["graphVersion"],
        "rootNodeId": sorted_node_ids[0] if sorted_node_ids else None,
        "nodes": {node_id: copy.deepcopy(graph["nodes"][node_id]) for node_id in sorted_node_ids},
        "edges": included_edges,
        "includedNodeIds": sorted_node_ids,
        "includedEdgeIds": [edge["id"] for edge in sorted_edges(included_edges)],
        "markers": [],
        "omissions": {
            "reason": None,
            "selectedNodeCount": len(ordered_node_ids),
            "selectedEdgeCount": len(ordered_edge_ids),
        },
    }

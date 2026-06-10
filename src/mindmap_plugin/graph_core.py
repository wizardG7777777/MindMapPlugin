from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any

from .errors import ConflictError, ToolInputError, ValidationError

KNOWN_DIAGRAM_KINDS = {
    "mindmap",
    "fishbone",
    "flowchart",
    "concept-map",
    "dependency-graph",
}

NODE_FIELDS = {"id", "title", "cardContent", "notes", "meta"}
NODE_PATCH_FIELDS = {"title", "cardContent", "notes", "meta"}
EDGE_FIELDS = {"id", "source", "target", "kind", "order", "meta"}
EDGE_PATCH_FIELDS = {"source", "target", "kind", "order", "meta"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def normalize_node(node: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(node)
    normalized.setdefault("cardContent", "")
    normalized.setdefault("notes", "")
    normalized.setdefault("meta", {})
    return normalized


def normalize_edge(edge: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(edge)
    normalized.setdefault("kind", "contains")
    normalized.setdefault("meta", {})
    return normalized


def validate_document(document: dict[str, Any]) -> None:
    if not isinstance(document, dict):
        raise ValidationError("Document must be a JSON object.")
    if document.get("JSON-SchemaVersion") != 1:
        raise ValidationError("Unsupported JSON-SchemaVersion.", {"expected": 1, "actual": document.get("JSON-SchemaVersion")})

    metadata = document.get("metadata")
    graph = document.get("graph")
    if not isinstance(metadata, dict):
        raise ValidationError("metadata must be an object.")
    if not isinstance(graph, dict):
        raise ValidationError("graph must be an object.")
    if not isinstance(metadata.get("id"), str) or not metadata["id"]:
        raise ValidationError("metadata.id must be a non-empty string.")
    if not isinstance(metadata.get("graphVersion"), int):
        raise ValidationError("metadata.graphVersion must be an integer.")

    diagram_kind = graph.get("diagramKind")
    if diagram_kind not in KNOWN_DIAGRAM_KINDS:
        raise ValidationError("graph.diagramKind is not registered.", {"diagramKind": diagram_kind})

    nodes = graph.get("nodes")
    edges = graph.get("edges")
    if not isinstance(nodes, dict):
        raise ValidationError("graph.nodes must be an object keyed by node id.")
    if not isinstance(edges, dict):
        raise ValidationError("graph.edges must be an object keyed by edge id.")
    if graph.get("entryNodeId") not in nodes:
        raise ValidationError("graph.entryNodeId must exist in graph.nodes.", {"entryNodeId": graph.get("entryNodeId")})

    for node_id, node in nodes.items():
        if not isinstance(node, dict):
            raise ValidationError("Each node must be an object.", {"nodeId": node_id})
        if node.get("id") != node_id:
            raise ValidationError("Node id must match its map key.", {"key": node_id, "nodeId": node.get("id")})
        unknown = set(node) - NODE_FIELDS
        if unknown:
            raise ValidationError("Node contains unsupported canonical fields.", {"nodeId": node_id, "fields": sorted(unknown)})
        title = node.get("title")
        if not isinstance(title, str) or not title.strip():
            raise ValidationError("Node title must be non-empty.", {"nodeId": node_id})
        if not isinstance(node.get("cardContent", ""), str):
            raise ValidationError("Node cardContent must be a string.", {"nodeId": node_id})
        if not isinstance(node.get("notes", ""), str):
            raise ValidationError("Node notes must be a string.", {"nodeId": node_id})
        if not isinstance(node.get("meta", {}), dict):
            raise ValidationError("Node meta must be an object.", {"nodeId": node_id})

    for edge_id, edge in edges.items():
        if not isinstance(edge, dict):
            raise ValidationError("Each edge must be an object.", {"edgeId": edge_id})
        if edge.get("id") != edge_id:
            raise ValidationError("Edge id must match its map key.", {"key": edge_id, "edgeId": edge.get("id")})
        unknown = set(edge) - EDGE_FIELDS
        if unknown:
            raise ValidationError("Edge contains unsupported canonical fields.", {"edgeId": edge_id, "fields": sorted(unknown)})
        if edge.get("source") not in nodes:
            raise ValidationError("Edge source must exist in graph.nodes.", {"edgeId": edge_id, "source": edge.get("source")})
        if edge.get("target") not in nodes:
            raise ValidationError("Edge target must exist in graph.nodes.", {"edgeId": edge_id, "target": edge.get("target")})
        if not isinstance(edge.get("kind"), str) or not edge["kind"].strip():
            raise ValidationError("Edge kind must be a non-empty string.", {"edgeId": edge_id})
        if "order" in edge and not isinstance(edge["order"], int):
            raise ValidationError("Edge order must be an integer when present.", {"edgeId": edge_id})
        if not isinstance(edge.get("meta", {}), dict):
            raise ValidationError("Edge meta must be an object.", {"edgeId": edge_id})


def summarize_document(document: dict[str, Any]) -> dict[str, Any]:
    validate_document(document)
    graph = document["graph"]
    relation_counts: dict[str, int] = {}
    for edge in graph["edges"].values():
        relation_counts[edge["kind"]] = relation_counts.get(edge["kind"], 0) + 1
    return {
        "documentId": document["metadata"]["id"],
        "title": document["metadata"]["title"],
        "graphVersion": document["metadata"]["graphVersion"],
        "diagramKind": graph["diagramKind"],
        "entryNodeId": graph["entryNodeId"],
        "nodeCount": len(graph["nodes"]),
        "edgeCount": len(graph["edges"]),
        "relationCounts": relation_counts,
    }


def get_node(document: dict[str, Any], node_id: str) -> dict[str, Any]:
    validate_document(document)
    try:
        return copy.deepcopy(document["graph"]["nodes"][node_id])
    except KeyError as exc:
        raise ToolInputError("Node does not exist.", {"nodeId": node_id}) from exc


def sorted_edges(edges: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        edges.values(),
        key=lambda edge: (
            edge.get("source", ""),
            edge.get("kind", ""),
            edge.get("order", 10**9),
            edge.get("id", ""),
            edge.get("target", ""),
        ),
    )


def get_neighbors(document: dict[str, Any], node_id: str, direction: str = "both") -> dict[str, Any]:
    validate_document(document)
    if node_id not in document["graph"]["nodes"]:
        raise ToolInputError("Node does not exist.", {"nodeId": node_id})
    if direction not in {"outgoing", "incoming", "both"}:
        raise ToolInputError("direction must be outgoing, incoming, or both.", {"direction": direction})
    incoming = []
    outgoing = []
    for edge in sorted_edges(document["graph"]["edges"]):
        if direction in {"outgoing", "both"} and edge["source"] == node_id:
            outgoing.append(copy.deepcopy(edge))
        if direction in {"incoming", "both"} and edge["target"] == node_id:
            incoming.append(copy.deepcopy(edge))
    return {"nodeId": node_id, "incoming": incoming, "outgoing": outgoing}


def apply_operation(document: dict[str, Any], operation: dict[str, Any]) -> set[tuple[str, str]]:
    graph = document["graph"]
    nodes = graph["nodes"]
    edges = graph["edges"]
    operation_type = operation.get("type")
    affected: set[tuple[str, str]] = set()

    if operation_type == "addNode":
        node = normalize_node(operation.get("node") or {})
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            raise ValidationError("addNode requires node.id.")
        if node_id in nodes:
            raise ValidationError("addNode node.id already exists.", {"nodeId": node_id})
        nodes[node_id] = node
        affected.add(("node", node_id))
    elif operation_type == "updateNode":
        node_id = operation.get("nodeId")
        patch = operation.get("patch")
        if node_id not in nodes:
            raise ValidationError("updateNode target does not exist.", {"nodeId": node_id})
        if not isinstance(patch, dict):
            raise ValidationError("updateNode patch must be an object.", {"nodeId": node_id})
        unknown = set(patch) - NODE_PATCH_FIELDS
        if unknown:
            raise ValidationError("updateNode patch contains unsupported fields.", {"nodeId": node_id, "fields": sorted(unknown)})
        nodes[node_id].update(patch)
        affected.add(("node", node_id))
    elif operation_type == "removeNode":
        node_id = operation.get("nodeId")
        if node_id not in nodes:
            raise ValidationError("removeNode target does not exist.", {"nodeId": node_id})
        if operation.get("edgePolicy") != "removeIncidentEdges":
            raise ValidationError("removeNode requires edgePolicy removeIncidentEdges.", {"nodeId": node_id})
        del nodes[node_id]
        affected.add(("node", node_id))
        for edge_id, edge in list(edges.items()):
            if edge["source"] == node_id or edge["target"] == node_id:
                del edges[edge_id]
                affected.add(("edge", edge_id))
    elif operation_type == "addEdge":
        edge = normalize_edge(operation.get("edge") or {})
        edge_id = edge.get("id")
        if not isinstance(edge_id, str) or not edge_id:
            raise ValidationError("addEdge requires edge.id.")
        if edge_id in edges:
            raise ValidationError("addEdge edge.id already exists.", {"edgeId": edge_id})
        edges[edge_id] = edge
        affected.add(("edge", edge_id))
    elif operation_type == "updateEdge":
        edge_id = operation.get("edgeId")
        patch = operation.get("patch")
        if edge_id not in edges:
            raise ValidationError("updateEdge target does not exist.", {"edgeId": edge_id})
        if not isinstance(patch, dict):
            raise ValidationError("updateEdge patch must be an object.", {"edgeId": edge_id})
        unknown = set(patch) - EDGE_PATCH_FIELDS
        if unknown:
            raise ValidationError("updateEdge patch contains unsupported fields.", {"edgeId": edge_id, "fields": sorted(unknown)})
        edges[edge_id].update(patch)
        affected.add(("edge", edge_id))
    elif operation_type == "removeEdge":
        edge_id = operation.get("edgeId")
        if edge_id not in edges:
            raise ValidationError("removeEdge target does not exist.", {"edgeId": edge_id})
        del edges[edge_id]
        affected.add(("edge", edge_id))
    elif operation_type == "setEntryNode":
        node_id = operation.get("nodeId")
        if node_id not in nodes:
            raise ValidationError("setEntryNode target does not exist.", {"nodeId": node_id})
        graph["entryNodeId"] = node_id
        affected.add(("node", node_id))
    elif operation_type == "reorderEdges":
        source = operation.get("source")
        kind = operation.get("kind")
        edge_ids = operation.get("edgeIds")
        if source not in nodes:
            raise ValidationError("reorderEdges source does not exist.", {"source": source})
        if not isinstance(kind, str) or not kind:
            raise ValidationError("reorderEdges kind must be a non-empty string.")
        matching = [edge["id"] for edge in sorted_edges(edges) if edge["source"] == source and edge["kind"] == kind]
        if sorted(edge_ids or []) != sorted(matching):
            raise ValidationError("reorderEdges must include exactly all matching edges.", {"expected": matching, "actual": edge_ids})
        for order, edge_id in enumerate(edge_ids):
            edges[edge_id]["order"] = order
            affected.add(("edge", edge_id))
    else:
        raise ValidationError("Unsupported operation type.", {"type": operation_type})

    return affected


def check_scope(document: dict[str, Any], envelope: dict[str, Any]) -> None:
    restrictions = envelope.get("scopeRestrictions") or {}
    if not restrictions:
        return
    allowed_nodes = set(restrictions.get("allowedNodeIds") or [])
    allowed_edges = set(restrictions.get("allowedEdgeIds") or [])
    forbidden_nodes = set(restrictions.get("forbiddenNodeIds") or [])
    allowed_edge_kinds = set(restrictions.get("allowedEdgeKinds") or [])
    disallow_delete = bool(restrictions.get("disallowDeleteOperations"))

    for operation in envelope.get("operations", []):
        operation_type = operation.get("type")
        if disallow_delete and operation_type in {"removeNode", "removeEdge"}:
            raise ValidationError("Delete operations are disallowed by scope restrictions.", {"type": operation_type})
        node_ids = set()
        edge_ids = set()
        edge_kinds = set()
        if "nodeId" in operation:
            node_ids.add(operation["nodeId"])
        if operation_type == "addNode" and isinstance(operation.get("node"), dict):
            node_ids.add(operation["node"].get("id"))
        if operation_type == "addEdge" and isinstance(operation.get("edge"), dict):
            edge = operation["edge"]
            edge_ids.add(edge.get("id"))
            node_ids.update([edge.get("source"), edge.get("target")])
            edge_kinds.add(edge.get("kind", "contains"))
        if "edgeId" in operation:
            edge_ids.add(operation["edgeId"])
            existing = document["graph"]["edges"].get(operation["edgeId"])
            if existing:
                node_ids.update([existing["source"], existing["target"]])
                edge_kinds.add(existing["kind"])
        if operation_type == "reorderEdges":
            node_ids.add(operation.get("source"))
            edge_ids.update(operation.get("edgeIds") or [])
            edge_kinds.add(operation.get("kind"))

        if forbidden_nodes.intersection(node_ids):
            raise ValidationError("Operation touches forbidden nodes.", {"nodeIds": sorted(forbidden_nodes.intersection(node_ids))})
        if allowed_nodes and not node_ids.issubset(allowed_nodes):
            raise ValidationError("Operation exceeds allowed node scope.", {"nodeIds": sorted(node_ids - allowed_nodes)})
        if allowed_edges and edge_ids and not edge_ids.issubset(allowed_edges):
            raise ValidationError("Operation exceeds allowed edge scope.", {"edgeIds": sorted(edge_ids - allowed_edges)})
        if allowed_edge_kinds and edge_kinds and not edge_kinds.issubset(allowed_edge_kinds):
            raise ValidationError("Operation exceeds allowed edge kinds.", {"edgeKinds": sorted(edge_kinds - allowed_edge_kinds)})


def preview_operations(document: dict[str, Any], envelope: dict[str, Any]) -> dict[str, Any]:
    validate_document(document)
    if envelope.get("documentId") != document["metadata"]["id"]:
        raise ValidationError("Operation envelope documentId does not match document.", {"documentId": envelope.get("documentId")})
    if envelope.get("baseGraphVersion") != document["metadata"]["graphVersion"]:
        raise ConflictError("Operation envelope is based on a stale graphVersion.", {"baseGraphVersion": envelope.get("baseGraphVersion"), "currentGraphVersion": document["metadata"]["graphVersion"]})
    if not isinstance(envelope.get("operations"), list):
        raise ValidationError("Operation envelope requires operations array.")
    check_scope(document, envelope)

    draft = copy.deepcopy(document)
    affected: set[tuple[str, str]] = set()
    for operation in envelope["operations"]:
        affected.update(apply_operation(draft, operation))
    validate_document(draft)

    affected_nodes = sorted(value for kind, value in affected if kind == "node")
    affected_edges = sorted(value for kind, value in affected if kind == "edge")
    return {
        "ok": True,
        "documentId": document["metadata"]["id"],
        "baseGraphVersion": document["metadata"]["graphVersion"],
        "nextGraphVersion": document["metadata"]["graphVersion"] + 1,
        "operationCount": len(envelope["operations"]),
        "affectedNodeIds": affected_nodes,
        "affectedEdgeIds": affected_edges,
        "summary": f"{len(envelope['operations'])} operation(s), {len(affected_nodes)} node(s), {len(affected_edges)} edge(s) affected.",
    }


def apply_operations(document: dict[str, Any], envelope: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    preview = preview_operations(document, envelope)
    draft = copy.deepcopy(document)
    for operation in envelope["operations"]:
        apply_operation(draft, operation)
    draft["metadata"]["graphVersion"] += 1
    draft["metadata"]["updatedAt"] = utc_now()
    validate_document(draft)
    return draft, {**preview, "applied": True}

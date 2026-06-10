from __future__ import annotations

import argparse
import sys
from typing import Any

from .errors import MindMapError
from .graph_core import apply_operations, get_neighbors, get_node, preview_operations, summarize_document, validate_document
from .io import print_json, read_json, write_json
from .layout import to_reactflow_view
from .mermaid import compile_document_to_mermaid_context
from .projections import extract_subtree


def add_document_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--document", required=True, help="Path to a canonical graph JSON document.")


def add_operation_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--operations", required=True, help="Path to an operation envelope JSON file, or '-' for stdin.")


def command_validate(args: argparse.Namespace) -> dict[str, Any]:
    document = read_json(args.document)
    validate_document(document)
    return {"ok": True, **summarize_document(document)}


def command_summary(args: argparse.Namespace) -> dict[str, Any]:
    return {"ok": True, **summarize_document(read_json(args.document))}


def command_get_node(args: argparse.Namespace) -> dict[str, Any]:
    return {"ok": True, "node": get_node(read_json(args.document), args.node_id)}


def command_get_neighbors(args: argparse.Namespace) -> dict[str, Any]:
    return {"ok": True, **get_neighbors(read_json(args.document), args.node_id, args.direction)}


def command_extract_subtree(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "ok": True,
        "projection": extract_subtree(
            read_json(args.document),
            args.start_node_id,
            direction=args.direction,
            max_depth=args.max_depth,
            cycle_policy=args.cycle_policy,
        ),
    }


def command_compile_mermaid(args: argparse.Namespace) -> dict[str, Any]:
    return compile_document_to_mermaid_context(
        read_json(args.document),
        start_node_id=args.start_node_id,
        direction=args.direction,
        max_depth=args.max_depth,
        orientation=args.orientation,
        include_edge_kinds=not args.omit_edge_kinds,
        include_node_content=args.include_node_content,
        max_nodes=args.max_nodes,
        max_edges=args.max_edges,
    )


def command_preview(args: argparse.Namespace) -> dict[str, Any]:
    return preview_operations(read_json(args.document), read_json(args.operations))


def command_apply(args: argparse.Namespace) -> dict[str, Any]:
    document = read_json(args.document)
    envelope = read_json(args.operations)
    updated, result = apply_operations(document, envelope)
    output_path = args.output or args.document
    write_json(output_path, updated)
    return {**result, "outputPath": output_path}


def command_render_reactflow(args: argparse.Namespace) -> dict[str, Any]:
    view_state = read_json(args.view_state) if args.view_state else None
    return to_reactflow_view(read_json(args.document), view_state=view_state)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="mindmap", description="Codex Mind Map plugin CLI.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate-document")
    add_document_arg(validate)
    validate.set_defaults(handler=command_validate)

    summary = subparsers.add_parser("get-document-summary")
    add_document_arg(summary)
    summary.set_defaults(handler=command_summary)

    node = subparsers.add_parser("get-node")
    add_document_arg(node)
    node.add_argument("--node-id", required=True)
    node.set_defaults(handler=command_get_node)

    neighbors = subparsers.add_parser("get-neighbors")
    add_document_arg(neighbors)
    neighbors.add_argument("--node-id", required=True)
    neighbors.add_argument("--direction", choices=["incoming", "outgoing", "both"], default="both")
    neighbors.set_defaults(handler=command_get_neighbors)

    subtree = subparsers.add_parser("extract-subtree")
    add_document_arg(subtree)
    subtree.add_argument("--start-node-id", required=True)
    subtree.add_argument("--direction", choices=["incoming", "outgoing", "both"], default="outgoing")
    subtree.add_argument("--max-depth", type=int, default=3)
    subtree.add_argument("--cycle-policy", choices=["mark"], default="mark")
    subtree.set_defaults(handler=command_extract_subtree)

    mermaid = subparsers.add_parser("compile-mermaid-context")
    add_document_arg(mermaid)
    mermaid.add_argument("--start-node-id")
    mermaid.add_argument("--direction", choices=["incoming", "outgoing", "both"], default="outgoing")
    mermaid.add_argument("--max-depth", type=int, default=3)
    mermaid.add_argument("--orientation", choices=["LR", "TD"], default="LR")
    mermaid.add_argument("--include-node-content", choices=["none", "card", "notes"], default="card")
    mermaid.add_argument("--omit-edge-kinds", action="store_true")
    mermaid.add_argument("--max-nodes", type=int)
    mermaid.add_argument("--max-edges", type=int)
    mermaid.set_defaults(handler=command_compile_mermaid)

    preview = subparsers.add_parser("preview-operations")
    add_document_arg(preview)
    add_operation_arg(preview)
    preview.set_defaults(handler=command_preview)

    apply = subparsers.add_parser("apply-operations")
    add_document_arg(apply)
    add_operation_arg(apply)
    apply.add_argument("--output", help="Output document path. Defaults to overwriting --document.")
    apply.set_defaults(handler=command_apply)

    reactflow = subparsers.add_parser("render-reactflow-view")
    add_document_arg(reactflow)
    reactflow.add_argument("--view-state")
    reactflow.set_defaults(handler=command_render_reactflow)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        print_json(args.handler(args))
        return 0
    except MindMapError as error:
        print_json(error.to_dict())
        return 1
    except Exception as error:
        print_json({"ok": False, "error": {"code": "UNEXPECTED_ERROR", "message": str(error), "details": {}}})
        return 1


if __name__ == "__main__":
    sys.exit(main())

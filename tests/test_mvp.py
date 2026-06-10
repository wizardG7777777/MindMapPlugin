from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from mindmap_plugin.graph_core import apply_operations, preview_operations, validate_document
from mindmap_plugin.mermaid import compile_document_to_mermaid_context
from mindmap_plugin.projections import extract_subtree

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_DOCUMENT = ROOT / "samples" / "documents" / "sample-mindmap.json"
SAMPLE_OPERATION = ROOT / "samples" / "operations" / "add-pricing.json"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


class MindMapMvpTests(unittest.TestCase):
    def test_sample_document_is_valid(self) -> None:
        document = load_json(SAMPLE_DOCUMENT)
        validate_document(document)

    def test_mermaid_output_is_deterministic(self) -> None:
        document = load_json(SAMPLE_DOCUMENT)
        first = compile_document_to_mermaid_context(document, start_node_id="market", max_depth=3)
        second = compile_document_to_mermaid_context(document, start_node_id="market", max_depth=3)
        self.assertEqual(first["mermaid"], second["mermaid"])
        self.assertIn("n_market", first["mermaid"])
        self.assertIn("n_research", first["mermaid"])

    def test_extract_subtree_preserves_canonical_ids(self) -> None:
        document = load_json(SAMPLE_DOCUMENT)
        projection = extract_subtree(document, "market", max_depth=3)
        self.assertIn("market", projection["includedNodeIds"])
        self.assertIn("research", projection["includedNodeIds"])
        self.assertIn("edge_market_research_reference", projection["includedEdgeIds"])

    def test_preview_does_not_mutate_document(self) -> None:
        document = load_json(SAMPLE_DOCUMENT)
        document["metadata"]["graphVersion"] = 7
        original = copy.deepcopy(document)
        envelope = load_json(SAMPLE_OPERATION)
        preview = preview_operations(document, envelope)
        self.assertTrue(preview["ok"])
        self.assertEqual(document, original)
        self.assertIn("pricing", preview["affectedNodeIds"])

    def test_apply_operations_increments_graph_version(self) -> None:
        document = load_json(SAMPLE_DOCUMENT)
        document["metadata"]["graphVersion"] = 7
        envelope = load_json(SAMPLE_OPERATION)
        updated, result = apply_operations(document, envelope)
        self.assertTrue(result["applied"])
        self.assertEqual(updated["metadata"]["graphVersion"], 8)
        self.assertIn("pricing", updated["graph"]["nodes"])

    def test_stale_base_graph_version_is_rejected(self) -> None:
        document = load_json(SAMPLE_DOCUMENT)
        envelope = load_json(SAMPLE_OPERATION)
        envelope["baseGraphVersion"] = 6
        with self.assertRaises(Exception):
            preview_operations(document, envelope)


if __name__ == "__main__":
    unittest.main()

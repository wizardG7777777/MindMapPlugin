# CLI Workflows

Status: executable examples for CLI contract version 1, program 0.2.0. The new tests exercise these fixtures through separate executable processes. Run in a disposable directory with the release executable on PATH.

The repository includes the [empty document](../samples/documents/empty-plan.json), [graph-building batch](../samples/operations/build-general-graph.json), [writer A batch](../samples/operations/writer-a.json) and [writer B batch](../samples/operations/writer-b.json) for these examples. Copy operation files before editing them; retain the submitted bytes for exact retries.

## Discover and create

```sh
mindmap --version --json
mindmap capabilities --json
mindmap schema operations --json
mindmap create ./plan.json --id plan --title 'Shared plan' --json
mindmap inspect ./plan.json --json
mindmap context ./plan.json --all --json
```

Creation returns schema 2, version 0, empty nodes/edges/commits and a null entry. Creating the same path again returns `ALREADY_EXISTS` without changing bytes. An empty all-context contains empty arrays and zero omissions; it does not invent a root node.

## Build a general directed graph

Save the following exact JSON as `changes.json`. This graph includes a three-node cycle, a self-loop, multiple parents of c, two edges from a to b, and a disconnected node x.

```json
{
  "envelopeVersion": 1,
  "documentId": "plan",
  "baseGraphVersion": 0,
  "operationId": "build-general-graph",
  "scope": {"mode": "document", "allowDelete": false},
  "operations": [
    {"type": "addNode", "node": {"id": "a", "title": "Research"}},
    {"type": "addNode", "node": {"id": "b", "title": "Implement", "cardContent": "Build the prototype", "notes": "Detailed implementation notes"}},
    {"type": "addNode", "node": {"id": "c", "title": "Review"}},
    {"type": "addNode", "node": {"id": "x", "title": "Independent idea"}},
    {"type": "addEdge", "edge": {"id": "ab", "source": "a", "target": "b", "kind": "next"}},
    {"type": "addEdge", "edge": {"id": "bc", "source": "b", "target": "c", "kind": "next"}},
    {"type": "addEdge", "edge": {"id": "ca", "source": "c", "target": "a", "kind": "next"}},
    {"type": "addEdge", "edge": {"id": "ac", "source": "a", "target": "c", "kind": "references"}},
    {"type": "addEdge", "edge": {"id": "aa", "source": "a", "target": "a", "kind": "next"}},
    {"type": "addEdge", "edge": {"id": "ab2", "source": "a", "target": "b", "kind": "depends-on"}},
    {"type": "setEntryNode", "nodeId": "a"}
  ]
}
```

```sh
mindmap preview ./plan.json --input changes.json --json
mindmap apply ./plan.json --input changes.json --json
mindmap validate ./plan.json --json
mindmap context ./plan.json --all --mermaid --json
```

Preview leaves the file unchanged and predicts version 1. Apply commits version 1 with one receipt, four nodes and six edges. Validate checks the receipt and graph. The context contains every edge, including ca and aa; its Mermaid preserves the closing edge and self-loop. x remains visible in all-context despite being disconnected.

## Independent readers

In separate terminals, with no intervening commit:

```sh
mindmap node ./plan.json --id x --content title --json
```

```sh
mindmap neighbors ./plan.json --id c --direction incoming --kinds next --json
```

```sh
mindmap context ./plan.json --nodes a --depth 2 --direction outgoing --kinds next --mermaid --json
```

The first result reads x only. The second returns nodes b,c, internal edge bc, and boundary records ab and ca; it does not retrieve x. The third returns a,b,c and internal next edges aa,ab,bc,ca. All results report version 1. The caller's choice neither changes the document bytes nor alters another reader's scope.

To request both title and long notes, call `node` with `--content all`. Omitted fields and truncation are explicit. Two reads around a commit may have different versions; use one combined context request when a common version is needed.

## Lost response and exact retry

```sh
mindmap apply ./plan.json --input changes.json --json
mindmap inspect ./plan.json --operation-id build-general-graph --json
```

After the successful initial apply, this retry returns `replayed: true` and the original receipt. The graph remains version 1. Keep the operation file byte-for-byte unchanged. Reformatting it while retaining the operation ID returns `OPERATION_ID_REUSE`.

## Concurrent writers

Starting from version 1, save the two independent requests as `writer-a.json` and `writer-b.json`:

```json
{
  "envelopeVersion": 1,
  "documentId": "plan",
  "baseGraphVersion": 1,
  "operationId": "writer-a-1",
  "scope": {"mode": "ids", "nodeIds": ["a"], "edgeIds": [], "allowDelete": false},
  "operations": [{"type": "updateNode", "nodeId": "a", "patch": {"title": "Research refined"}}]
}
```

```json
{
  "envelopeVersion": 1,
  "documentId": "plan",
  "baseGraphVersion": 1,
  "operationId": "writer-b-1",
  "scope": {"mode": "ids", "nodeIds": ["b"], "edgeIds": [], "allowDelete": false},
  "operations": [{"type": "updateNode", "nodeId": "b", "patch": {"title": "Implementation refined"}}]
}
```

Run apply in separate processes. Both batches are individually valid; exactly one new commit is accepted. The other returns exit 4 with `CONFLICT`, expected version 1 and current version 2. Its intended change is not claimed as saved.

The losing caller rereads the relevant content, checks the intended edit, and writes a revised batch with a fresh operation ID and current version. A subsequent accepted commit reaches version 3. The caller must not just change the version field and assume the edit is still appropriate.

These examples exercise behavior, not model-provider integration. The acceptance harness must run them through distinct executable processes and assert outputs and persisted bytes.

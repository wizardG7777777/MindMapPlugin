# Reading and Editing Architecture

Status: target CLI contract version 1. This document owns the human/agent workflow; [persistence](persistence-and-concurrency.md) owns its transactional mechanism.

## Equal readers

A person and any number of agents may independently invoke queries on one document. Each command declares its own nodes, edges, direction, relation filters, depth and fields. A person's recent read does not become another agent's default context. One reader may inspect a node while another reads its incoming dependencies and a third reads the whole graph.

One command builds all of its output from one complete snapshot and labels the result with that snapshot's version. Readers can overlap each other and a writer. There is no reader-owned edit session, shared focus or document lock held during reasoning. Separate queries may return different committed versions; combining their results requires comparing those versions or issuing a new query containing the combined selectors.

## Read, prepare, preview, commit

```mermaid
sequenceDiagram
  participant H as Person
  participant A as Agent
  participant D as Document
  H->>D: Read nodes a,b
  D-->>H: Scope a,b at version 4
  A->>D: Read incoming relations of c
  D-->>A: Scope around c at version 4
  Note over H,A: Independently prepare operations; no edit lock
  H->>D: Preview batch at version 4
  D-->>H: Diff and prospective version 5
  A->>D: Commit batch based on version 4
  D-->>A: Committed version 5
  H->>D: Commit batch based on version 4
  D-->>H: CONFLICT, current version 5
  H->>D: Read required scope again
  D-->>H: Fresh result at version 5
```

A preview validates a batch against the version read for that preview and returns a structured before/after diff. It does not change the document, reserve IDs, issue an approval token or guarantee that the batch remains current. Apply validates again inside the commit transaction.

On a conflict, reread enough context to reconsider the intended edit, create a revised batch with a new operation ID, and preview again when the change warrants it. Merely replacing `baseGraphVersion` without checking the graph is not a conflict resolution strategy. Automatic merging and branch locking are outside the first delivery.

## Mutation authority

Both actors submit the [same operation envelope](operation-schema.md). Read scope describes facts included in a result. Write scope is explicitly supplied with the batch and checked against all actual effects. Reading an adjacent node does not authorize changing it; omitting a node from context does not mean it is absent from the document.

`actor` is optional attribution. It does not bypass validation, turn an agent into a trusted system writer, or establish authorization. CLI calls rely on the user's requested task and local file access. Destructive batches must explicitly permit deletes in their scope. There is no interactive approval service inside the program; host approval policy, when present, remains the host's responsibility.

Structural edits operate on nodes and edges. Reparenting is an edge change, not a hidden tree-specific mutation. Display-only changes cannot be submitted as graph operations. A full read can be exported, but the mutation command accepts only typed operations, never a complete replacement graph.

## Commit outcomes and retries

A successful apply returns a durable receipt and observed current version. If the response is lost, retry the exact same input bytes and operation ID. The command resolves the receipt before testing the batch's now-old base version. The same ID with different bytes is rejected.

A conflict, invalid operation, out-of-scope indirect effect or document-size failure leaves the committed file unchanged. An I/O failure after publication may have an uncertain outcome; it is reported as such and must be resolved using the same operation ID. If an interrupted operation never committed and another writer advanced the graph, exact retry returns `CONFLICT`; the absence of that operation's receipt resolves its outcome, but the intended change needs reconsideration. Retry behavior and lock-release requirements are defined in [persistence](persistence-and-concurrency.md).

## Verification

After commit, reread affected nodes/edges or validate the whole document. Another writer may commit before this reread; inspect the returned version rather than expecting it always to equal the receipt's committed version. Receipt history confirms whether a particular batch committed; it does not provide historical graph snapshots.

The first delivery is complete only when these flows pass using independent CLI processes. No browser selection or visual preview is needed; human-readable diffs and JSON results provide the headless review surface.

## Human writing UI

The implemented browser editor uses the same read/prepare/preview/commit mechanism. Per-tab drafts retain their original version and external commits require explicit conflict review. The UI offers node/edge editing and versioned content references without sharing selection with agents; see [WebUI](webui.md).

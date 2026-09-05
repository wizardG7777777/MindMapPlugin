# Persistence and Concurrency

Status: target first-delivery storage contract. This document defines the mechanism required for independent readers and cooperating local writers. A version comparison outside this mechanism is insufficient.

## Supported storage

The first implementation uses one JSON snapshot per document on a local filesystem with tested atomic same-directory replacement and durable file/directory synchronization. The initial platform adapters target macOS and Linux; a release advertises only OS/architecture/filesystem combinations that pass the gates. Other platforms, network shares and storage without the required primitives return `UNSUPPORTED_STORAGE` for writes. Platform/storage support is checked before adapter acquisition. An unadvertised platform returns `UNSUPPORTED_STORAGE` with reason `platform`; a missing or unloadable adapter on an advertised supported platform returns `LOCK_UNAVAILABLE`. Local read-only inspection of an otherwise valid file need not require a locking adapter.

Cross-process write exclusion uses an operating-system-managed advisory lock on a stable lock file. On the initial POSIX adapters this requires a real kernel file lock (for example `flock` through a packaged native binding), not an in-memory mutex or a PID-only sentinel. The kernel releases ownership when the owning process exits. Never infer that a lock is dead merely from its age, and never unlink or replace a stable lock file to steal ownership.

The package must ship usable runtime adapters for its declared platforms; requiring an undeclared compiler or global utility fails [installation acceptance](acceptance.md). A port file, lock directory without safe crash recovery, or a per-process queue alone cannot satisfy this contract.

## Document identity and coordination files

Resolve an existing target to its physical path. For creation resolve the existing physical parent and normalize the basename using filesystem case rules. Aliases of the same target, including supported symlinks and case aliases, must coordinate through the same lock. Existing hard-linked targets (`nlink > 1`) are rejected for mutation because replacement would split aliases. Reject paths whose filesystem identity cannot be established safely.

For canonical target path P, the lock lives under P's parent at `.mindmap/locks/<SHA-256 of canonical P>.lock`. The directory is created only by mutation or an explicit diagnostic probe. It contains coordination state, not selected nodes or graph truth. Read commands never create it. Lock files remain after release and are reusable.

The lock is held on a non-inheritable file descriptor. All supported writers use this same path resolver and adapter. Arbitrary external file edits are outside the guarantee; malformed files are reported, never automatically overwritten or repaired. The document parent must exist before create.

## Snapshot reads

1. Open the document file once and enforce the 64 MiB bound while reading.
2. Read from that opened handle, parse and validate the entire snapshot, including receipts.
3. Build every result component from that immutable in-memory document.

Readers take no edit lock and do not wait for a thinking agent or a preview. An atomic replacement can cause different readers to observe different committed versions. Each reader sees a complete old or new snapshot, never a prefix of a write. No multi-command historical snapshot service is promised; save one result or request the combined scope in one command when a common version is needed.

## Create transaction

Acquire the target's exclusive lock, recheck target absence, generate the normalized empty schema-2 document, and publish it using the same durable publication sequence as apply. Any existing target produces `ALREADY_EXISTS`, including an invalid file. Creation does not append an operation receipt and starts at graph version 0.

If creation loses its response, inspect the target before retrying. An explicit `--id` makes intended identity easy to verify. Creation retries never overwrite an existing document and do not claim exact-replay semantics.

## Apply transaction

Parse and bound input first. Retain the original input bytes for the request hash. Once the exclusive lock is acquired:

1. Reload and validate the current complete snapshot inside the lock. Recheck document identity.
2. Look up `operationId`. Exact request-hash match returns its receipt; different hash returns `OPERATION_ID_REUSE`. This check precedes base-version and current-target checks.
3. For a new ID, compare `baseGraphVersion` to the locked snapshot. On mismatch return `CONFLICT` without mutation.
4. Apply operations in memory, tracking all direct, indirect and intermediate effects. Validate scope, operation rules and final document invariants.
5. Increment the version exactly once; append a receipt with the raw-input hash and update the commit timestamp. The graph and receipt form one snapshot.
6. Serialize the candidate and enforce the 64 MiB document bound before any publication.
7. Publish durably as below; only then return success. Release the lock in every exit path.

Use a monotonic clock for acquisition deadlines. Time waiting for the exclusive lock is bounded by `--lock-timeout-ms`. `LOCK_TIMEOUT` means no transaction was published by that invocation. No lock is held while an agent reads context, prepares a file or decides whether a preview is acceptable. Reads and previews remain available while a writer owns the lock.

## Durable publication

Write a uniquely named temporary file in the target directory with exclusive creation. Preserve existing target permission bits on apply; create uses the platform's user-private default subject to umask. Write all bytes, flush file contents to stable storage, then atomically replace the target while still holding the lock. Synchronize the parent directory to persist publication before acknowledging success. Temporary and target must be on the same filesystem.

The atomic replacement is the visibility point. Success is acknowledged only after directory synchronization. The lock covers reading, checking, replacing and synchronization; atomic replacement alone does not prevent lost updates. No separate receipt file or journal is committed independently from the graph.

Before replacement, failure leaves the committed target unchanged. After replacement but before confirmed durability, return `COMMIT_OUTCOME_UNKNOWN` if the process can respond, including operation ID and retry guidance. Following an uncertain response, an exact apply retry that finds the receipt must synchronize the current file and parent before acknowledging replay, so it does not treat visible-but-unsynced data as confirmed durable. Synchronization failure remains an uncertain outcome.

A process killed during publication may return nothing. After recovery the target must be either the complete preceding snapshot or the complete succeeding snapshot, with receipt presence matching the graph. A retry with the same bytes returns an existing receipt, commits the missing operation once if its base version is still current, or returns `CONFLICT` if it has no receipt and another operation advanced the graph. In the third case, report that this operation ID is uncommitted in the checked snapshot; the caller rereads and reconsiders a new batch. Never automatically rebase the uncertain operation. Different operation IDs cannot be used to resolve uncertainty.

Temporary files from crashes are not treated as documents or used as an automatic source of truth. Normal failures remove their own uncommitted temporary file where possible. Orphan cleanup, if implemented, requires the document lock and must only remove identifiable uncommitted temporary files; it may not delete or replace the target or stable lock file.

## Receipts and limits

Receipts are retained with the document, covering all committed operation IDs until the document reaches its size limit. A later graph edit does not invalidate receipt lookup. Exactness is defined over input bytes, so changed formatting is a new payload and cannot reuse an old operation ID.

The receipt's committed version and the current snapshot version are distinct on replay. Reads may observe commits made after the original receipt. The receipt log supports deduplication and attribution, not undo or reconstruction of historical graph snapshots.

## Required failure evidence

The [acceptance specification](acceptance.md) requires separate-process races, lock-owner termination, alias tests, read-during-write tests, permission and I/O failures, and failpoints before/after publication. Unit tests of pure graph operations cannot establish these properties. Durability claims are limited to tested platform/filesystem guarantees; power-loss claims require explicit additional evidence.

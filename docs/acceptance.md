# Acceptance

Status: normative first-delivery gates. This file defines tests to run against an implementation; it does not report them as passed. A documentation review can approve contract completeness and feasibility, but cannot establish CLI runtime reliability.

## Evidence levels

1. **Specification review:** compare every rule, command, example and error across the documents; check that tests have concrete setup, actions and observable outcomes. Record unresolved issues. This can be performed before implementation.
2. **Runtime acceptance:** execute the gates below against the actual executable and persistence adapters. Store command outputs, exit statuses and relevant before/after artifacts.
3. **Package/platform acceptance:** repeat applicable gates from the built package in each advertised environment. Record artifact hash, CLI version, Node version, OS/architecture and filesystem.

None of these levels implies the next. A successful build, help command or unit test suite alone is insufficient.

## Running the implementation checks

Use Node 24.15.0 on the advertised macOS arm64/APFS configuration. `npm test` builds the runtime and runs the new tests under `test/`. `npm run test:package` packs and installs the artifact into a clean temporary directory, repeats those tests through its executable with package files read-only, and records results in `test-results/package/`.

The package evaluator is a separate schema-driven program supplied with the installed executable, help, schemas and skill. It receives no graph-core imports or internal fixtures. Its actual calls and final graph are recorded, and its CLI commands run with network access and child-process creation denied by an operating-system sandbox. This is automated caller acceptance, not an assertion that a particular external model provider was exercised.

| Gates | Executable evidence |
| --- | --- |
| C01–C04, C06–C08, C11–C12 | `test/commands.test.js`, `test/invalid-data.test.js` |
| C05 | `test/mermaid.test.js`, using pinned Mermaid 11.17.2 and jsdom 30.0.1 |
| C09–C10, C14 | `test/queries.test.js` |
| C13, P06 storage failures | `test/storage.test.js` |
| P01–P08, P10 | `test/concurrency.test.js`, with a separate-process failpoint runner |
| P09 | `test/invalid-data.test.js` |
| R01–R05 for the advertised configuration | `scripts/package-acceptance.js` and `test/helpers/evaluate-package.js` |

## Harness requirements

Use temporary directories and an explicit path to the release executable. The harness may be written in any available test language; the product itself must not require that language. Validate JSON results against the published result schema and independently inspect persisted documents against the document schema.

Use separate OS processes for races, not only promises calling a shared in-process function. Read the input fixtures from [CLI workflows](cli-workflows.md) or maintain equivalent validated fixtures with identical expected graphs. Record deterministic expected node/edge sets, version counts, receipts and exit statuses.

A test-only persistence adapter must expose failpoints after locked reload, after temporary-file sync, after replacement and before directory sync, and after durability but before response. Failpoints must not be user-facing release options. The harness controls ready/release barriers and can kill a process at a named point. Also run ordinary release-build races without failpoints. This makes rare interleavings reproducible without pretending the test adapter alone proves the packaged binary.

## Command and data gates

| ID | Setup and action | Required observation |
| --- | --- | --- |
| C01 | Run version, root/command help, capabilities and all four schema names. | Correct product identity and contract/schema versions; exact catalog matches CLI reference; complete machine schemas; no opaque operation or result payload. Unsupported visual capabilities are not advertised. |
| C02 | Create the workflow document; inspect, validate and read all-context. Attempt creation again. | Empty normalized schema-2 graph at version 0; null entry; zero receipts; second create exits 3 `ALREADY_EXISTS`, byte-identical target. |
| C03 | Preview then apply `changes.json`; inspect and validate. | Preview leaves bytes unchanged; 11 operations; affected nodes a,b,c,x and edges aa,ab,ab2,ac,bc,ca. Apply reaches version 1 with one matching receipt, four nodes and six edges. |
| C04 | Run node, neighbors and scoped context examples in independent processes. | Exact node/internal-edge/boundary sets from the workflow; each version 1; no focus files or altered graph bytes. |
| C05 | Run all-context and Mermaid on the workflow graph. | Disconnected x, closing ca, self-loop aa and parallel ab/ab2 retained; deterministic IDs and edge order. Parse generated Mermaid using a pinned parser and test unsafe label fixtures; compare semantic graph as well as syntax. |
| C06 | Run every operation type in isolated valid fixtures: add/update/remove node/edge, entry set/clear, reorder, document update. | Each effect matches operation schema, increments once and has correct diff/affected IDs/receipt. Remove-entry batches must explicitly clear or replace entry; empty final graph has null entry. |
| C07 | Submit duplicate IDs, dangling endpoints, unsupported fields, empty patches, invalid titles/order, duplicate JSON keys, invalid UTF-8, wrong schema/identity and zero operations. | Specified error class and nonzero exit; original target and receipts unchanged. No partial batch writes. |
| C08 | ID-scope fixtures: edge endpoint rewrites, incident edge removal, reorder, add IDs, remove-then-readd and document changes. | Every direct/indirect/intermediate target checked; empty allowlists mean no permission. Unlisted endpoints/edges or forbidden deletes fail, including changes hidden by an unchanged final diff. |
| C09 | Read title/card/all content, empty strings, long multibyte titles/notes, full meta. | Selected fields and omission reasons match; truncation respects code points and byte bounds; returned full meta unchanged. No omitted field is silently represented as empty. |
| C10 | Exercise depth 0/1/2, incoming/outgoing/both, kinds, selected edges, combined seeds, disconnected all, all budgets and boundary limits. | Candidate and omission counts follow context contract; explicit selections cannot silently disappear; ties use deterministic ID order; cyclic expansion terminates. |
| C11 | Invalid flags/enums/options, repeated single-valued options, quoted paths, file/stdin inputs and readable/JSON modes. | Exact one-object JSON output and exit mapping; diagnostics only on stderr; no prompts or unintended stdin reads. Readable mode has identical mutations/statuses. |
| C12 | Query an unknown node, edge or receipt; inspect known receipt after subsequent commits. | Missing objects exit 3 `NOT_FOUND`; known receipt keeps its committed version while envelope reports observed current version. |
| C14 | Use a valid document with 10001 isolated nodes, a separate fixture with 20001 parallel edges, and a text field of exactly 1048577 ASCII bytes (total document below 64 MiB; the full append operation input including envelope must remain below 8 MiB). Run export and full-text node read. | Export discovers all IDs and exact content; node with max-text-bytes 0 returns the entire field. Use that full value to append text through updateNode, then verify the original prefix byte-for-byte and the exact suffix. Normal limited context still reports accurate omissions. Full export cannot be submitted as an operation envelope. |
| C13 | Run doctor without and with an explicit test directory; test read-only/unavailable adapter cases. | No-write mode is read-only. Explicit probe reports actual primitive checks, cleans its probe artifacts and never alters a graph; unsupported writes fail visibly. |

## Concurrency and recovery gates

| ID | Setup and action | Required observation |
| --- | --- | --- |
| P01 | Three reader processes repeatedly request different scopes from a fixed graph. | All results have their own expected scopes/version; no graph or coordination files created by reads. |
| P02 | Hold writer A after locked reload; start writer B with the same base version and different ID; release A. Also run repeated barrier-start races without failpoints. | Exactly one new commit; loser exits 4 `CONFLICT`; graph version increases by one; only winner receipt exists. No pair of success reports hides lost content. |
| P03 | While a writer is paused before/after replacement, run repeated readers and previews. | Readers continue without acquiring the edit lock; each result matches complete old or new snapshot and version, with no JSON corruption or mixed counts/content. Preview either matches its base version or conflicts; it never reserves a commit. |
| P04 | Apply one operation ID twice, concurrently and after later commits. Repeat with same ID/different bytes. | One receipt and one increment for identical bytes; replay returns original receipt. Changed bytes exit 3 `OPERATION_ID_REUSE`. Receipt lookup succeeds even if original targets no longer exist. |
| P05 | Hold a commit lock beyond a second caller's timeout; then kill its owner. | Second call exits 5 `LOCK_TIMEOUT` without publishing. A fresh caller can acquire the kernel-released lock; stable lock file existence does not block it. |
| P06 | Race writers through relative/absolute paths and supported symlink/case aliases; attempt a hard-linked target. | Aliases contend on one lock. Hard-linked mutation fails before publication. Unsupported alias/storage conditions fail explicitly rather than create independent writers. |
| P07 | Kill a writer before temporary-file sync, after sync/before replace, after replace/before directory sync, and after durability/before response. | Target is a valid complete preceding or succeeding snapshot, with matching receipt. Without an intervening commit, exact retry commits once or replays. Also kill A before replacement, let B commit, then retry A: it must return `CONFLICT` with A uncommitted, never silently rebase. No version gaps or duplicate ID receipts. Uncommitted temp files never become truth. |
| P08 | Inject disk-full/permission/sync/replace errors before and after visibility point. | Pre-publication errors preserve target bytes. Possibly published results report uncertainty; exact replay synchronizes before claiming durable success. All paths release locks. |
| P09 | Attempt oversized operation input, too many operations, oversized candidate including receipts, and out-of-range numeric fields in input/document fixtures. | Byte/count limits return LIMIT_EXCEEDED; invalid numeric input/document fields return INVALID_ENVELOPE/INVALID_DOCUMENT as applicable. All fail before publication, with original bytes/version/receipts unchanged. Reading an oversized file fails without allocating unbounded memory. |
| P10 | Two processes create the same absent path simultaneously; kill create around publication. | One valid version-0 document; losing create reports `ALREADY_EXISTS`. Interrupted create is absent or complete; retries never overwrite it. |

For P02/P04, assert receipt contents and persisted fields, not merely exit codes. For P07/P08, distinguish process-crash recovery from power-loss durability. Power-loss claims require additional platform evidence; tests must not overstate what process termination establishes.

## Installation and first-delivery gates

| ID | Setup and action | Required observation |
| --- | --- | --- |
| R01 | Install the packed artifact into a clean temporary environment with only declared runtime prerequisites. Make package files read-only. | Executable, schemas, docs, skill and locking adapters resolve without source checkout, global compiler or development dependencies. No personal absolute path is needed. |
| R02 | Run the complete workflow, all commands and concurrency/storage tests through that executable. Use a cwd and document path containing spaces. | Same behavior as source tests; data/locks outside package directory; no permission mutation to make package caches writable. |
| R03 | Run all graph commands with network unavailable after dependencies are installed; observe child processes and listeners, then wait for process exit. | No browser, listening socket, host registration, provider account, background process or persistent connection is required. Commands terminate, leaving document/receipts and permissible stable lock files only. |
| R04 | Give an independent evaluator only the built package, help, schemas and skill, plus a request to build and refine a cyclic graph while another reader inspects an unrelated node. | Evaluator discovers correct capabilities, preserves cycles, requests independent scopes, performs validated edits and verifies results without source inspection or an external tool catalog. Record actual calls and graph. |
| R05 | Execute applicable gates for every advertised OS/architecture/filesystem and supported Node version. | Support matrix contains only tested combinations. Unavailable adapters fail before mutation. Artifact version/hash and environment are included in evidence. |

## Specification acceptance before implementation

Review every Markdown document and skill, rather than a selected happy-path subset. Check:

- A single public CLI; no active host-specific tool implementation standard or implicit graphical dependency.
- Independent human/agent reads, explicit scopes and single-snapshot results.
- Complete command, operation, result and error definitions, including empty creation and general directed graphs.
- Feasible cross-process coordination and publication with explicit resource/platform limits.
- Test coverage for failure, concurrency, exact retries and packaging, with implementable barriers and concrete assertions.
- Working links, consistent examples, clearly deferred visual features, and no claims that planned commands already run.

An independent review reports actionable contradictions and missing behavior, not just a keyword count. Resolve findings and review the corrected contract before declaring the documentation accepted. Actual runtime gates remain unexecuted until a conforming implementation exists.

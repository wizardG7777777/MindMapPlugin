# CLI Reference

Status: CLI contract version 1, implemented in program 0.2.0. All commands below are included in the headless delivery. See [command contract](command-contract.md) for common results, limits and exit statuses, and [command result data](command-results.md) for exact JSON payloads.

## Command catalog

| Command | Options and defaults | Success `data` |
| --- | --- | --- |
| `mindmap --version` | No command-specific options | Product/release/contract/schema identity |
| `mindmap --help` or `mindmap <command> --help` | Help never requires a document | `usage`, `description`, `arguments`, `options`, `examples` |
| `mindmap capabilities` | No command-specific options | Complete identity, command/option definitions, graph/format/storage capabilities and limits |
| `mindmap schema <name>` | Required name: `document`, `operations`, `context`, `result` | The complete JSON Schema for that name |
| `mindmap create <document>` | `--title` defaults to `Untitled graph`; `--id` defaults to a generated UUID; `--lock-timeout-ms` defaults to 5000 | `path` and normalized `document` at version 0 |
| `mindmap inspect <document>` | Optional `--operation-id <id>` | Without ID: `path`, `metadata`, `topology`, `semanticType`, `entryNodeId`, `nodeCount`, `edgeCount`, `relationCounts`, `commitCount`; with ID: `path`, matching `receipt` |
| `mindmap export <document>` | No command-specific options; always complete | `path`, complete normalized `document`, including all content and receipts |
| `mindmap node <document> --id <id>` | `--content title|card|all` defaults to `card`; `--max-text-bytes` defaults to 4096 | `node` with selected content and `omissions.fields` |
| `mindmap neighbors <document> --id <id>` | Context options below, except selectors and depth; effective depth is 1 | Context result with the node as seed |
| `mindmap context <document>` | Explicit selectors and context options below | Context result |
| `mindmap preview <document> --input <file-or-dash>` | Input required | Preview data defined by the operation schema |
| `mindmap apply <document> --input <file-or-dash>` | Input required; `--lock-timeout-ms` defaults to 5000 | `receipt`, `replayed` |
| `mindmap validate <document>` | No command-specific options | `valid: true`, schema version, node/edge/commit counts |
| `mindmap doctor` | Optional `--directory <existing-directory>` for an explicit storage probe | Product identity, platform, `checks`, `supported` |

All accept `--json`. `--lock-timeout-ms` is a safe integer from 0 through 60000; zero attempts immediate acquisition and otherwise returns `LOCK_TIMEOUT`. Input `-` means stdin; no other command consumes stdin. `create` requires an existing parent directory and never overwrites a target. Its success data contains the fully normalized empty document from the data model.

`inspect --operation-id` returns `NOT_FOUND` for an absent receipt. `relationCounts` counts all edges by exact kind. Results contain no hidden session state. `validate` checks all persisted invariants including receipt consistency, not merely JSON syntax.

`doctor` without a directory reads environment and package metadata only. With a directory it explicitly creates, syncs, locks and removes uniquely named probe files there; it never touches graph files. `checks` is an array of `{name, ok, details}`; `supported` is their conjunction. Unsupported prerequisites return the corresponding exit-5 error with the checks in error details. This probe is not a substitute for full release testing.

## Context options

`context` requires `--all` or at least one of `--nodes <comma-separated-ids>` and `--edges <comma-separated-ids>`. Node and edge selectors may be combined; `--all` cannot be combined with either. Empty selectors, duplicate listed IDs and unknown explicit IDs are errors. An empty graph can be queried with `--all`.

| Option | Default | Semantics |
| --- | --- | --- |
| `--depth <integer>` | 0 | Minimum-distance expansion steps, 0 through 100; invalid with `--all` |
| `--direction outgoing|incoming|both` | outgoing | Traversal direction; valid for neighbors and scoped context; invalid with `--all` |
| `--kinds <comma-separated-values>` | All kinds | Relationship filter; omitted allows every kind. Values containing commas cannot be selected with this shorthand, but can still be returned with all kinds. |
| `--content title|card|all` | card | Content fields as defined by context management |
| `--max-nodes <integer>` | 200 | Returned nodes, 1 through 10000 |
| `--max-edges <integer>` | 400 | Internal returned edges, 1 through 20000 |
| `--max-boundary-edges <integer>` | 100 | Crossing-edge records, 0 through 20000 |
| `--max-text-bytes <integer>` | 4096 | Per selected title/card/notes field, 0 through 1048576 UTF-8 bytes; zero disables field truncation |
| `--mermaid` | Absent | Include structural Mermaid text and ID mappings in the result |
| `--orientation LR|TD` | LR | Only valid with `--mermaid`; affects text projection, not the graph |

`neighbors` allows direction, kinds, content, node/edge/boundary/text limits and Mermaid options; it does not accept `--depth`, `--all`, `--nodes` or `--edges`. Traversal and omission counting are fully defined in [context management](context-management.md).

Titles/card/notes are output-limited unless `--max-text-bytes 0` is requested, never silently shortened in the persisted document. `export` returns every record and full field from one snapshot without context limits, so IDs beyond context budgets remain discoverable. Save its JSON output to a report and select needed records there; it is not an apply input. Complete reads do not waive the 8 MiB mutation-input limit; an oversized replacement request fails LIMIT_EXCEEDED without changing the document. `meta` is returned only with `--content all` and is never partially truncated; output may therefore exceed text limits by its JSON size, bounded by the 64 MiB document limit. Overall query serialization must be streamed or otherwise tested within the documented envelope; limits are not a claim of a fixed token budget.

## Examples

```sh
mindmap context ./plan.json --nodes a --depth 2 --direction outgoing --content all --json
mindmap neighbors ./plan.json --id c --direction incoming --kinds depends-on --json
mindmap node ./plan.json --id b --content all --json
mindmap context ./plan.json --all --mermaid --json
mindmap inspect ./plan.json --operation-id build-general-graph --json
```

The file format for changes and exact-retry examples are in [CLI workflows](cli-workflows.md). Command names and options in this document must match `capabilities`, machine schemas and built-package behavior before release. There are no first-delivery visual, server, host-registration or language-model generation commands.

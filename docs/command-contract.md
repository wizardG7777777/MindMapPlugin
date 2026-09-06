# Command Contract

Status: target CLI contract version 1. The public interface consists solely of the commands in [CLI reference](cli-reference.md). The same commands serve people and agents. Exact success payloads and stable error details are defined in [command result data](command-results.md).

## Process behavior

- `render --raw` emits SVG/Mermaid text and routes errors to stderr; it is incompatible with `--json`. Other modes retain the envelope below.
- `--json` selects machine output; otherwise return a readable rendering of the same result. All commands accept `--json`.
- JSON mode writes exactly one UTF-8 JSON object followed by a newline to stdout. Diagnostics go to stderr, never mixed into the result. Parsing errors follow the same contract when `--json` appears as a standalone argument.
- No command prompts, reads terminal confirmation, opens a browser or starts a listener. Input is consumed from stdin only when explicitly requested with `--input -`.
- Unknown commands/options, missing required values, repeated single-valued options, malformed UTF-8, duplicate JSON keys and invalid enum values fail explicitly. Options are parsed without shell evaluation. Paths with spaces work as one quoted argument.
- Commands terminate after their result. `preview` and `apply` operate on exactly one file, with no output-path override or implicit current document.
- Relative paths resolve from invocation cwd. Path identity and file limits follow persistence rules. Readers do not create coordination files.

## Identity and discovery

`--version` returns product identity `mindmap-cli`, executable `version`, `cliContractVersion: 1`, and `documentSchemaVersions: [2]`. `capabilities` adds the exact available command/option schemas, topology properties, available context formats, resource limits, and tested platform/filesystem support. First delivery reports `topologies: ["directed"]`, cycles/multiple parents/self-loops/parallel edges/disconnected components supported, `visualLayouts: ["flowchart", "mindmap", "dependency", "network", "fishbone"]`, `renderFormats: ["svg", "mermaid"]`, and `requiresServer: false`.

`schema document|operations|context|result|layout` returns complete JSON Schema documents with a declared dialect, deterministic `$id`, all required properties, enums, bounds and `additionalProperties` behavior. `result` defines a discriminated union by command and success/error status, with complete command-specific `data` shapes; it must not use an unspecified object for an operation envelope or result. `context` describes the `data` returned by `context` and `neighbors`. Schemas, runtime validation, help and capabilities derive from one definition.

A package is not accepted merely because it identifies itself correctly. The behavior in [acceptance](acceptance.md) must pass.

## Result envelope

Every JSON-mode result has exactly:

```json
{
  "ok": true,
  "cliContractVersion": 1,
  "command": "inspect",
  "documentId": "plan",
  "graphVersion": 0,
  "data": {},
  "error": null
}
```

`data` above illustrates envelope placement only; its full per-command schema is specified in [command result data](command-results.md). On failure `ok` is false, `data` is null and `error` is `{code, message, details}`. `documentId` and `graphVersion` are null for commands without a document or failures before a valid snapshot is available. `command` is the attempted command name; absent commands use `""`. `--version` and `--help` use `version` and `help` respectively.

For success, the reported graph version is the snapshot actually used. A later reread can return a newer version. On a conflict, report the observed current version and include `{expectedVersion, currentVersion}` in details. Never label a version as current without reading it.

## Exit statuses and errors

| Exit | Codes | Meaning |
| --- | --- | --- |
| 0 | none | Success, including exact replay |
| 2 | `INVALID_ARGUMENT`, `INVALID_JSON`, `INVALID_ENVELOPE` | Command or input shape is invalid |
| 3 | `DOCUMENT_NOT_FOUND`, `ALREADY_EXISTS`, `UNSUPPORTED_SCHEMA`, `INVALID_DOCUMENT`, `NOT_FOUND`, `INVALID_OPERATION`, `SCOPE_VIOLATION`, `LIMIT_EXCEEDED`, `OPERATION_ID_REUSE`, `INVALID_LAYOUT` | Requested document or action is not valid |
| 4 | `CONFLICT` | Reread and reconsider a new batch |
| 5 | `LOCK_TIMEOUT`, `LOCK_UNAVAILABLE`, `IO_ERROR`, `UNSUPPORTED_STORAGE`, `COMMIT_OUTCOME_UNKNOWN` | Local storage or transaction could not complete as requested |
| 6 | `INTERNAL_ERROR` | Unexpected program failure; message does not claim rollback |

`error.details` contains structured context: field paths for invalid input, affected IDs for scope failures, configured/actual bounds for limits, and the path/OS error code for file failures when available. `NOT_FOUND` identifies a requested node, edge or operation receipt absent from a valid document. Unknown document schemas use `UNSUPPORTED_SCHEMA`; malformed bytes use `INVALID_JSON`; a structurally invalid parsed document uses `INVALID_DOCUMENT`.

Error precedence: parse command and bounded input -> resolve/read document -> validate schema and identity -> for apply acquire lock and reload -> receipt lookup -> version check -> operation/scope/final graph validation -> size/durability checks. Create checks target absence under its lock. Read commands validate their selectors after reading the snapshot. Insufficient access uses `IO_ERROR`; no command repairs or truncates a file as error recovery.

After a possibly published mutation, include `details.outcome: "unknown"` and the operation ID when available. Use `COMMIT_OUTCOME_UNKNOWN` for expected publication/durability uncertainty; unexpected internal errors also disclose whether publication may have occurred. A killed process may produce no result; the caller resolves uncertainty by exact replay, not by assuming failure means no change.

## Format and behavioral compatibility

Readable and JSON modes have identical effects and exit statuses. Readable formatting may improve without changing contract version; JSON field semantics cannot silently change. Persisted schemas and operation envelope versions are independently checked. No command infers an operation from prose, renderer coordinates or another application's similarly named tool.

The application does not install agent skills or modify host configuration as a side effect of ordinary graph commands. Skill discovery and installation are separate from graph access.

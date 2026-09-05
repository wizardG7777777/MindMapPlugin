# MindMap CLI

MindMap is a local directed-graph program with one public CLI for people and agents. Readers independently choose the document, nodes, relationships and content they need. A graph may contain cycles, multiple parents, parallel relationships, self-loops and disconnected components.

**Status: CLI contract version 1, target specification.** The documents describe the required implementation, not a claim that the current source or a published package already provides these commands. Runtime readiness is established only by the [acceptance gates](docs/acceptance.md). Examples use the intended executable name `mindmap`.

## First delivery

The first delivery is a complete headless workflow:

1. Discover the executable's identity, capabilities and schemas.
2. Create an empty document.
3. Let a person and several agents read independently, including different parts of the same document.
4. Prepare a typed operation batch using the version that was read.
5. Preview its actual changes without acquiring an edit session.
6. Commit through a cross-process transaction, then read again to verify the result.

Ordinary commands run and exit. They require no browser, listening port, background service, account or model API. External agent applications provide reasoning and invoke the same commands available to a person. The program does not generate natural-language plans on its own.

The only public automation interface is the CLI. There is no separately registered agent tool catalog. Visual editing, themes and automatic layouts are deferred and are not dependencies of the first delivery.

## Independent reads, coordinated commits

A read has explicit selectors and returns one complete committed graph version. It neither changes another reader's scope nor acquires a document edit lock. Different readers may observe different versions if a commit occurs between their reads; each result identifies its version.

Read scope is context, not mutation authority. An operation batch declares its own write scope. All writers use the same transaction rules: recheck the current version under a short exclusive commit lock, validate the entire batch, and publish one complete snapshot. Stale edits fail visibly; automatic conflict merging is outside the first delivery.

## Example workflow

```sh
mindmap capabilities --json
mindmap create ./plan.json --id plan --title 'Product plan' --json
mindmap inspect ./plan.json --json
mindmap context ./plan.json --all --json
```

Prepare the operation file described in the [complete workflow](docs/cli-workflows.md), then run:

```sh
mindmap preview ./plan.json --input changes.json --json
mindmap apply ./plan.json --input changes.json --json
mindmap context ./plan.json --all --mermaid --json
mindmap validate ./plan.json --json
```

These are target commands, not instructions to run an unreleased package. [Installation](docs/installation.md) defines how a release must make them available without a source checkout. The [agent skill](skills/mindmap-cli/SKILL.md) teaches the workflow but is not required for CLI access.

## Specification ownership

| Document | Authority |
| --- | --- |
| [Architecture](docs/architecture.md) | Module ownership and delivery boundaries |
| [Data model](docs/data-model.md) | Persisted document fields and graph invariants |
| [Operation schema](docs/operation-schema.md) | Mutation payloads and write scope |
| [Command contract](docs/command-contract.md) | Process behavior, results, errors and public schemas |
| [Command result data](docs/command-results.md) | Exact success payloads and stable error details |
| [CLI reference](docs/cli-reference.md) | Complete command and option catalog |
| [Context management](docs/context-management.md) | Independent query scope, limits and returned facts |
| [Editing architecture](docs/editing-architecture.md) | Human and agent read/prepare/commit workflows |
| [Persistence and concurrency](docs/persistence-and-concurrency.md) | Snapshot reads, commit locking, durability and retries |
| [Mermaid projection](docs/mermaid-projection.md) | Optional structural text projection |
| [CLI workflows](docs/cli-workflows.md) | End-to-end examples |
| [Installation](docs/installation.md) | Package contents and release execution |
| [Acceptance](docs/acceptance.md) | Executable release gates and evidence requirements |
| [Implementation roadmap](docs/implementation-roadmap.md) | Work order and exit criteria |
| [View state](docs/view-state.md), [theme and template](docs/theme-template.md) | Deferred visual boundaries |

Each rule has one owning document. Examples and the skill reference these contracts; they do not define alternative mutation semantics. Package release version, CLI contract version, persisted schema version and graph content version are different values.

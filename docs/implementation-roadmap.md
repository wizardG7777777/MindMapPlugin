# Implementation Roadmap

Status: target implementation order. All completion claims require the evidence defined in [acceptance](acceptance.md).

## Phase 1: Contract and fixtures

Implement the canonical schema, operation envelope, command/results schemas and independent context result. Publish capability definitions from the same schema source. Turn [workflow examples](cli-workflows.md) into validated fixtures, including empty graph, cycle, self-loop, multiple parents, parallel edges and disconnected nodes.

Exit: every documented command and error has an unambiguous schema and acceptance case. Normative examples validate. This is a design/fixture gate, not proof that commands run.

## Phase 2: Headless vertical slice

Build create, inspect, export, node, neighbors, context, preview, apply and validate with the common result envelope. Add version/help/capabilities/schema discovery and doctor. Use real transactional persistence from the first apply implementation; a direct-write shortcut cannot count as completion.

Exit: the complete workflow runs through the executable in independent processes, without a browser, account, socket or background service. A person and two simulated agent callers read different scopes without shared state. All required commands exist; optional visual commands are not advertised.

## Phase 3: Concurrency, recovery and limits

Exercise cross-process commit races, exact retries, kernel lock release on death, physical-path aliases, bounded output, invalid batches, read-only storage and interrupted publication. Resolve every failure or narrow advertised storage support explicitly.

Exit: all concurrency/storage gates pass with failure injection and full assertions. Receipt/version correctness and no silent lost updates are mandatory. Passing graph unit tests alone cannot close this phase.

## Phase 4: Packaging and agent usability

Produce a self-contained installable artifact with compiled code, schemas, supported runtime adapters and the skill. Test from a clean installation with immutable package files. Have an independent reader execute a realistic directed-cycle task using only package help, schemas and skill, without supplied internal operation examples beyond the packaged material.

Exit: install/runtime gates and independent workflow acceptance pass. Each advertised platform has its own evidence. Only then may README and release metadata state runtime availability.

## Later delivery: Visual interaction

Visual editing, layouts, themes, window-specific selections and automatic refresh can follow without changing the CLI's graph authority. [View state](view-state.md) and [theme/template](theme-template.md) define their boundaries. They must not delay, substitute for or weaken headless acceptance.

Automatic merge, remote synchronization, historical graph snapshots and agent memory are separate future decisions. They are not implicit first-delivery requirements.

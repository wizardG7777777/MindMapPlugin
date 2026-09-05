# View State

Status: deferred visual-interface design. No view-state command, selection service or browser is required or advertised by the headless first delivery.

## Boundary

The canonical document stores graph facts. A future view stores positions, dimensions, viewport, collapse state and layout choice separately. Missing view state must never prevent CLI reads, preview, apply or validation.

A view is identified by document identity plus a view/session identifier. Several windows may display one document with different positions, focus and selected IDs. No single global selection can determine all readers' query scopes.

## Query handoff

A future UI may turn a selection into an explicit query request or saved context report containing document ID, graph version and selected IDs. The receiver chooses whether to use that request. Updating a window's selection never changes an in-progress CLI batch or grants mutation authority.

Selection, focus and cursor state belong to individual view sessions. Saved layout is presentation state. Neither is canonical graph content or global agent memory.

## Editing and refresh

Future semantic edits must call the same command handlers and persistence transaction as CLI edits. Dragging changes presentation only unless the user explicitly requests a relationship edit. UI state cannot bypass operation validation.

A future visual service must have a lifecycle independent of any one agent, coordinate startup by workspace/document, and refresh after external CLI commits. Its runtime files live outside package installation directories. These are future acceptance requirements, not claims that the headless CLI starts such a service.

## Deferred work

Window lifecycle, selection exchange, layout persistence, visual diff, automatic refresh and interactive editing are a separate delivery after [headless acceptance](acceptance.md). Their transport and detailed schemas are intentionally not part of the current command contract.

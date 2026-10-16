# Local Writing UI

Status: optional local interface over the existing graph core. No MCP or agent-host registration is introduced. CLI read/write/render commands remain independently usable without a server.

## Launch and lifecycle

```sh
mindmap ui ./plan.json
mindmap ui ./plan.json --port 0 --json
```

The target document must already exist and be valid. The command binds only `127.0.0.1`. Port 0 is the default and asks the operating system for an unused port; separate invocations can serve the same document without competing for a fixed port. A requested occupied port fails with `IO_ERROR`/`EADDRINUSE`; the program never terminates or takes over another process.

Readable output prints the local launch URL and document path. JSON output emits one startup envelope with `{path, url, host, port}` and then remains alive. This explicitly long-running command stops on Ctrl+C/SIGTERM. It does not automatically open a browser. Keep its terminal running while using the UI. Closing a browser tab does not stop the service or affect CLI agents.

There is no global UI registry, current document or selected-node file. Each service is pinned to one physical file and document ID. The launch URL includes a per-process capability token in its fragment. The page keeps that token in tab-local session storage and removes it from the address bar. A new browser session should use the complete launch URL. Graph references and exported artifacts never include that token.

## Writing and graph edits

The workspace has a full-width pan/zoom diagram beside a content-focused editor for node names and body text. Save/discard and delete actions stay in a fixed footer while the content scrolls. Stored notes and metadata remain intact but are not shown as ordinary writing fields; an unsaved notes draft from an older tab is temporarily exposed for recovery until saved or discarded. Select nodes and edges directly on the diagram; Shift-click selects multiple items. There is no separate outline/search sidebar. It supports document title changes, adding nodes, connecting existing nodes, editing edge endpoints/labels/order, selecting an entry, and deleting nodes/edges.

A node offers **Connect to…** and **Add connected node**. Connecting starts a canvas target picker: click a target node, review the source/target names and relationship description, then confirm. Escape or Cancel exits without writing. Save/discard an existing draft before creating nodes or edges. The connection retains its starting graph version; an intervening commit causes a conflict rather than silently changing its basis. Removing an endpoint cancels the picker/dialog.

Select a line on the canvas to see its direction and edit its description or delete it. Endpoint changes and ordering live under **Adjust connection**. Deleting a line preserves both nodes. Deletion confirmation uses node names and relationship descriptions, not raw JSON. Deleting a node identifies its incident-edge deletions; removing the entry also clears the entry in the same transaction.

The node sidebar has no More settings section: node-ID tools, body-link insertion controls, entry selection and flow-role/merge editing are not exposed there. Existing IDs, entry selection and flow metadata remain unchanged and available through the CLI. New-node IDs are automatically generated and editable only under the creation dialog's extra settings.

Save or Cmd/Ctrl+S commits the current editor's changed fields. The browser prepares ordinary operation envelopes, previews them, and submits them to the same persistence transaction as CLI apply. It never overwrites the graph JSON or bypasses graphVersion, scope, receipts, size limits or kernel locking. The current UI supports one active editor draft per tab; switching away from an unsaved draft requires the user's choice to discard it. The draft is retained across reloads of that tab while its session storage is available. Closing the tab ends that tab-local draft storage.

The current release automatically lays out the graph; moving the viewport does not move nodes in the stored graph. Persistent drag coordinates and rich-text editing are separate future work. The saved graph type is displayed as a read-only label and cannot be changed in the canvas toolbar or document editor. Orientation, pan and zoom remain adjustable. Old tab-local layout overrides are ignored. If a layout cannot be produced, correct the node/edge definitions in the editor when accessible or through the CLI; switching graph types is not a recovery path. A graph that exceeds all rendering limits can be exported as JSON or adjusted through the CLI; no truncated substitute graph is displayed.

## Concurrent human and agent work

Each tab owns its selection, draft, orientation and camera. Agents read their own CLI scopes; no browser selection becomes an agent's implicit context.

The UI polls for committed graph versions. An external CLI or second-window commit refreshes the saved graph. It preserves a dirty editor draft and its original base version. Save never silently substitutes the newest graphVersion. On conflict, the user reviews the latest saved values against the draft and explicitly approves a new request. That approval is tied to the reviewed version, so a further commit while the review dialog is open causes another conflict.

Only fields the user edited are patched. A reviewed title change does not overwrite a concurrently edited notes field. The API returns the committed snapshot with a successful apply response, so the UI does not depend on a second read to know what was saved.

After an uncertain apply response, the browser retains the exact original request bytes and operation ID, disables competing edits and offers exact retry. A committed request replays its receipt; an uncommitted stale request conflicts. Reloading the same tab retains this pending request in session storage. Restarting the service on the same port and reopening its new launch URL can reconnect that tab-local state. There is no claim that browser session storage is durable graph history or that it survives closing the tab.

## Referencing graph content

Select one or more nodes, then choose **Copy for Agent**. The clipboard contains exactly two kinds of information: `JSON 文件：<absolute path>` on the first line, followed by one `节点 ID：<id>` line per explicitly selected node. The path comes from the server's resolved physical file path and retains the host system's native Windows or Unix syntax without JSON quoting or backslash escaping. IDs are copied verbatim from the graph; each directly addresses `graph.nodes[id]`. Document validation rejects duplicate keys and requires each node map key to equal its record ID.

The button is disabled when no nodes are selected, including edge-only selections. Mixed selections copy only the nodes. Neighbor depth applies only to **View reference**, not **Copy for Agent**. No instructions, edge IDs, depth, titles, body text, notes, metadata, timestamp or graph version are appended. Copying uses the tab's selection without requesting a full snapshot. If clipboard access fails, the same text is shown for manual copying or download; its JSON view contains only `documentPath` and `nodeIds`.

The agent reads the current saved content from that file using the IDs. IDs are document-local, so the file path is necessary. The locator is not a frozen snapshot: later edits are visible and deleted IDs may no longer resolve. Unsaved drafts are not referenced. The receiving agent needs access to the file.

Choose **View reference** when a complete saved snapshot is needed. This supports selected nodes/edges and optionally one or two neighboring layers. The server captures it and returns:

- `citation`: document ID, physical document path, graphVersion, explicit node/edge selectors, depth and capture time.
- `context`: the existing independent context result, including full selected title/body/notes/meta, internal edges, boundary relationships and any resource-limit omissions.
- `markdown` and `json`: copyable/downloadable representations of that snapshot.

Full snapshot capture checks the displayed version. If the graph changes before capture, it returns CONFLICT and the user can reread before copying. Unsaved editor text is not mixed into a saved-version citation. Copied data is supplied to another application only by the user's own paste/share action; the program never sends messages to an agent platform.

Within a node's body or notes, `[[node-id]]` denotes a same-document reference. The sidebar shows only distinct references actually present in the body as compact, navigable node-name links; it does not repeat the body or notes in a preview. This section is absent when the body has no references. Missing targets are visibly marked. A textual reference does not add a graph edge or grant write scope. These links resolve current content; a copied reference snapshot is the way to retain the exact cited content/version.

## Exports

The UI downloads complete canonical JSON, standalone SVG or Mermaid source. SVG/Mermaid use the saved graph type and current per-tab orientation through the shared renderer. Exports use saved content; a draft must be committed first to appear in the output. The reference dialog can separately download the captured citation/context as text or JSON.

## Local transport boundary

`src/ui/server.js` is an internal browser adapter, not a separately registered automation tool. It serves only the packaged `web/` assets and its pinned document. JSON API calls require the session token; Host and Origin checks reject cross-site access, and the page disallows external scripts and framing. Input bodies remain bounded to the operation-input limit and use the same strict UTF-8/JSON parser as the CLI.

Routes are `/api/state` (GET), `/api/preview`, `/api/apply`, `/api/render` and `/api/reference` (POST). State returns `{ok, path, document, graphType}` (the resolved fixed layout profile) or HTTP 204 for an unchanged version. Apply success returns `{ok, document, result}` where `result` is the normal CLI apply envelope and `document` is the snapshot returned by that transaction. Other POST routes use the usual result envelope with their corresponding payload. Conflict uses HTTP 409. The adapter rejects arbitrary file paths and does not expose a general-purpose filesystem or CLI execution endpoint.

## Verification

`test/ui-server.test.js` checks separate ports, shared transactional state, exact replay, conflicts, reference provenance, unchanged bytes on reads/previews, and transport rejection cases. `test/browser/ui.test.js` uses an isolated real Chromium session to edit and save text, create/delete nodes and edges with canvas target selection, cancel/stale-connection handling, preservation of stored metadata and older notes drafts, follow compact references, copy citations, exercise independent tabs and external CLI changes, review conflicts, retry lost responses, and download SVG.

```sh
npm test
npm run test:ui
```

Browser tests use the installed Chrome channel by default and can set `MINDMAP_BROWSER_CHANNEL`. On environments whose enclosing sandbox cannot launch Chrome, run those tests outside that sandbox. Browser test artifacts are written under `test-results/ui/`. Package acceptance also repeats browser tests against the immutable installed package; browser tooling is a development dependency, not a product runtime dependency.

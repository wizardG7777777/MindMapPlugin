# View State

Status: local writing UI implemented; persistent manual node positions remain deferred.

The canonical document stores graph facts. Layout/render commands return derived geometry. Each browser tab owns its selection, camera, orientation and active editor draft. Tab-local session storage can restore a draft or uncertain request after a reload; it is not graph history or a shared selection service.

No UI focus/selection file is written beside a document or in the package directory. Several UI services and browser tabs can view the same graph while agents make independent CLI reads. The service binds to an OS-assigned loopback port by default and never overwrites a global runtime registry.

External commits refresh saved content without replacing dirty draft fields or their base version. Conflict review, exact retries, references and lifecycle behavior are specified in [WebUI](webui.md). Rendering and graph-type policies are specified in [rendering](rendering.md).

Node dragging, persistent manual-coordinate overrides and rich-text editing remain future work. Panning/zooming in the current UI changes only the viewport and never emits a graph mutation.

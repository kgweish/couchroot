---
name: samsung-tv-ui
description: Develop and refine the Samsung TV Minimal Hub interface using its local browser workbench, shared fixtures, and remote-navigation tests. Use for this project's UI and preview work.
---

# Samsung TV Hub UI

Use the active `samsung-tv-hub` checkout. When loaded through a personal skill
symlink, resolve this skill's directory; the repository is three levels above it.
Start with [UI development](../../../docs/guides/ui-development.md). Read
[design rules](../../../docs/guides/design-guidelines.md) for visual work and
[compatibility](../../../docs/guides/device-compatibility.md) before changing runtime APIs.

## Source map

- `web/index.html`, `web/style.css`: structure, layout and appearance.
- `web/hub.js`: screens, remote input and focus restoration.
- `web/model.js`, `web/presentation.js`: saved favorites/navigation and artwork.
- `web/bridge.js`, `web/feedback.js`, `web/telemetry*.js`: platform adapters.
- `preview/`: shared mocks, scenarios and workbench; never shipped.

Run `npm run dev` and inspect the printed loopback URL. Use another `PORT` if an
existing server belongs to a different checkout. Edit the actual `web/` source;
do not build a separate demo. Scenarios share browser storage on one origin;
reset the scenario or use separate browser contexts for independent sessions.

Keep plain JavaScript/CSS compatible with the older QN90A browser. Retain the
existing flex-gap/sizing fallbacks and local artwork. Every action must work with
arrows, Enter/OK and Escape/Back. Preserve saved keys, cancellation semantics,
focus after asynchronous discovery and the explicit Samsung Home fallback.

For visual changes, capture a baseline before editing. Use `npm run screenshots`
for review PNGs, then inspect affected states at 1920×1080 and a smaller viewport.
Exercise affected error/empty states and remote navigation. Run relevant checks
while iterating and `npm test` before handoff; screenshots are not visual assertions.

If adding shipped assets, update the shared `tvsetup/planner.py::hub_sources`
manifest; the installed-file inventory in `tvsetup/transport.py` derives from it.
Packaging and signing consume that manifest;
retain model-specific idle/monitoring additions when packaging QN90A.

Document visible changes and remaining hardware checks. UI work alone does not
include installation. For an explicitly requested deployment, follow
[UI deployment](../../../docs/guides/ui-deployment.md).

# Gallery, Cinema and Home Shelf UI release review

Prepared for the owner fork on 2026-10-26 from `codex/tvos-hig-design`.
This release covers the Hub interface, bundled artwork, browser workbench and
package asset manifest. Device setup and root/DRM research remain separate.

## Included behavior

- Gallery uses the approved dock, smooth row navigation and settled selection.
  Landscape rotation resumes its remaining display time after returning Home.
- Cinema adds a five-shortcut rail with a hero and an apps/inputs drawer.
  It preserves saved ordering and restores the selected rail app on return.
- Home Shelf adds ten physical service cases per row. Each case has an opaque
  front and perpendicular side with fixed depth. Focus turns and lifts the case
  while followers on its row make room; reduced motion displays the pose instantly.
- Shelf rim and leather grain are separate bundled materials. Dark faces retain
  visible grain and raised edges. The selected case keeps its shape through
  interrupted arrows, launch progress and rapid OK/arrow input.
- Disney+, HBO Max and Sling use transparent publisher artwork. Spotify and Tubi
  recognize the titles advertised by the S89C. Readable text remains available
  when artwork fails. The source notes live in `web/logos/README.md`.
- Settings keeps Gallery, Comfortable, Compact, Cinema and Home Shelf available.
  Saved shortcuts, photo preference and Samsung Home fallback remain shared.

## Visual and interaction review

The implementation was compared with the approved shelf illustration at
1920×1080 and 960×540. Case spacing, selected depth and shared ledge were reviewed
with first, middle and final selections. The texture's crease pattern and bevel
lighting remain approximations of that illustration.

Focused checks cover row motion, reduced motion, missing scrolling APIs,
Move/Cancel, empty Home, missing artwork, failed launch and saved ordering.
The paint probe checks opaque common case bodies through the ledge during frozen
transition frames and interrupted movement. Separate visual review covers the
sloped upper contours. Launch feedback retains the rigid case pose.

Local review resolved the scoped important findings. Hardware rendering and
performance require a separate S89C trial; the last recorded TV installation is
0.4.6 and predates the final rigid-case refinement.

## Release checks

Fresh validation ran against a source-only export of the selected index:

- JavaScript/browser: 670 tests, 492 passed, 178 platform skips, zero failures.
- Setup/packaging Python: 689 tests, 464 passed, 225 platform skips, zero failures.
- The unsigned S89C package contains exactly 42 declared files, with every file
  matching the selected source bytes.
- The scan of changed source and image metadata found no flagged credentials,
  personal workspace paths, physical addresses or private/generated artifacts.
  Independent scoped review found no release-blocking issue.

These local results do not establish physical TV rendering or performance.
Browser screenshots and diagnostic logs remain outside Git. Package builds use
the explicit asset manifest and exclude browser fixtures, credentials and device
identities. The generated shelf room and case materials are original project
artwork; third-party logo sources retain their notices.

Publication targets `kgweish/couchroot` main. Upstream PR #5 retains its existing
S89C-support branch and revision. This release does not include TV deployment.

final result: local visual review passed; hardware acceptance pending

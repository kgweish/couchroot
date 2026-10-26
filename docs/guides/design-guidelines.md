# UI design rules

Minimal Hub is an offline launcher operated from a couch with a remote.

- Keep app artwork prominent, labels readable, and utility controls secondary.
  Reuse the existing palette, spacing and card treatments before adding styles.
- Make focus unmistakable. Every action must work with arrows, OK and Back;
  hover and pointer interactions are optional conveniences.
- Restore focus after closing a dialog, reordering, removing, or returning from
  an app. Async discovery must not steal focus from a control the user selected.
- Keep the explicit Samsung Home fallback reachable. Repeated Back on Home
  stays in the hub; cancelling a dialog preserves the previous state.
- Handle empty favorites, long lists, unavailable apps, missing artwork and
  failed saves visibly. Removing a shortcut must not imply uninstalling an app.
- Preserve existing storage keys and settings. Reset shortcuts requires
  confirmation and keeps unrelated preferences.
- Keep motion brief and honor reduced motion. Use local artwork and fonts;
  the launcher must not depend on a CDN or external service for rendering.
- Check 1920×1080 screenshots and a smaller viewport. Validate legacy CSS
  fallbacks using the [compatibility guide](device-compatibility.md).

## Conventions

- Comfortable and Compact tiles are 16:9. S89C Gallery uses 5:3 tiles, five across,
  with a glass dock around the first row. Tile artwork and wordmarks are sized in `em`;
  set one `font-size` per layout (about 11.5% of tile width) instead of
  per-brand overrides. Comfortable shows six tiles without scrolling, Compact twelve.
- Earlier layouts use a rounded `box-shadow` ring with instant focus. S89C Gallery
  adds a brief lift and white edge, with a static cue under reduced motion. Tiles use
  their `--accent`; destructive actions use `--alert`. Do not use `outline`.
- Keep the Home backdrop static in its bounded compositor layer and the footer
  in its own small layer. Focus must not invalidate full-screen gradients or
  repaint the tiles when moving between footer buttons. Do not promote every
  tile to a permanent layer; long favorites lists must stay memory-efficient.
- Utility pages use solid content panels. S89C Gallery adds glass utility controls
  and a dimmed landscape around those panels. Batch scroll-edge geometry reads before
  class updates, and refresh edge markers on scrolling rather than every arrow.
- Utility pages share one skeleton: rows on the left, a framed preview on the
  right, `.status-line` bottom-left and `.hint` key chips bottom-right. On Home a
  status message replaces the hints; pass `true` to `message()` for failures.
- Scrolling lists keep their normal opacity. `edges()` measures the first/last
  item and shows directional cues beside the viewport; padding alone is not more
  content. `reveal()` keeps the 12px ring gutter. Gallery remote navigation uses
  native smooth scrolling with a scaled gutter and consistent library row
  positions; reduced motion uses instant scrolling. Move and utility lists scroll
  instantly. Avoid
  gradient fades and masks: Home's background is not a flat color.
- Gallery scrolls Samsung Home, the grid and its footer in one viewport, below
  the greeting and clock. Its scaled gutter accommodates raised focus. Edit apps
  and Settings follow the final app row; their existing actions stay separate.
- Cinema shares Gallery's artwork, with the first five saved shortcuts on a
  single rail and a large hero that follows settled focus. Down opens the full
  library and inputs drawer; Back restores the rail selection. Keep its utility
  controls below the rail and preserve the saved list when layouts change.
  Photo rotation stays independent of app focus. Use local artwork and readable
  text fallbacks, and honor reduced motion for the drawer and hero updates.
- Home Shelf presents saved shortcuts as ten spines per row against bundled
  walnut materials. Case heights recede along a shared ledge. All cases turn
  slightly to reveal a right side, with neighboring surfaces meeting to cover
  the wall between them. Focus lifts and scales the selected case, revealing
  its broad side as the following cases on that row move over. Move keeps the
  case at its resting angle. The front and perpendicular side form a rigid
  3D case with fixed depth; focus changes its angle. Keep both surfaces opaque
  through interrupted pulls. Composite the rim normally above the grain and
  service color so dark cases retain their raised edge. Grouping properties
  such as isolation, filters and opacity must not flatten the case.
  Smaller primary logos sit above decorative brand badges. Each row settles
  on the same ledge. Keep input names on
  one caption, with their Samsung Home fallback explicit. Footer utilities stay
  below the shelf, and Move follows the ten visible columns. Reduced motion
  retains the selected pose and white focus edge with instant row movement.
  Launch feedback keeps this pose while showing the existing progress label.
- Remember Home selection independently of shortcut order. Delay writes until
  navigation settles and flush on hide/pagehide; unavailable storage must not
  block navigation. Late discovery preserves the currently selected footer control.
- Launch failures offer Back to apps, Retry and Samsung Home. Back restores the
  failed shortcut; timeouts and late callbacks must not interrupt another screen.
- Keep launch progress on the selected tile until Hub hides. API acceptance
  alone is not a completed handoff. Back dismisses progress without promising to
  cancel the TV's already submitted request.
- Move shortcuts in the actual Home grid, with a position indicator and explicit
  Save/Cancel. Keep the selected DOM node through each move. Arrow navigation
  follows the visible columns; no storage write occurs before saving.
- Undo restores the latest removed shortcut at its original index without
  discarding intervening edits. Keep it available for the session until used,
  replaced by another removal, or shortcuts are reset; failed saves keep Undo.
- Hold OK is optional and off by default. When enabled, a tap opens on release
  and a 650 ms hold opens actions. Interruptions cancel the pending hold. Keep
  the Edit apps route usable on remotes whose hold/release behavior differs.
- On return, reuse unchanged tiles and refresh discovery after the initial UI
  update. Changes in order, layout, names, icons or availability invalidate the
  cached grid; asynchronous updates preserve current focus.
- Dialogs put the safe action on the left with initial focus, the committing
  action on the right, and state what Back does.
- Empty lists explain themselves in place (`note()`); empty Home offers Add apps.

Review Home, Edit apps, Add apps, Settings and Reset after changes
that affect shared layout or focus. Use the workbench failure scenarios when
changing status messages, fallback artwork or persistence behavior.

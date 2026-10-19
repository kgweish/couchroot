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

- Tiles are 16:9 in every layout. Tile artwork and wordmarks are sized in `em`;
  set one `font-size` per layout (about 11.5% of tile width) instead of
  per-brand overrides. Comfortable shows six tiles without scrolling, Compact twelve.
- One focus treatment: a rounded `box-shadow` ring, instant, no motion. Tiles use
  their `--accent`; destructive actions use `--alert`. Do not use `outline`.
- Keep the Home backdrop static in its bounded compositor layer and the footer
  in its own small layer. Focus must not invalidate full-screen gradients or
  repaint the tiles when moving between footer buttons. Do not promote every
  tile to a permanent layer; long favorites lists must stay memory-efficient.
- Utility pages use solid backgrounds. Batch scroll-edge geometry reads before
  class updates, and refresh edge markers on scrolling rather than every arrow.
- Utility pages share one skeleton: rows on the left, a framed preview on the
  right, `.status-line` bottom-left and `.hint` key chips bottom-right. On Home a
  status message replaces the hints; pass `true` to `message()` for failures.
- Scrolling lists keep their normal opacity. `edges()` measures the first/last
  item and shows directional cues beside the viewport; padding alone is not more
  content. `reveal()` scrolls instantly and keeps the 12px ring gutter. Avoid
  gradient fades and masks: Home's background is not a flat color.
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

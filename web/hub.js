(function () {
  'use strict';
  function bootMark(name) { if (window.HubBootTrace) { window.HubBootTrace.mark(name); } }
  bootMark('hub-entry');
  // CSS.supports('gap') also matches grid-only implementations. Measure flex once.
  var gapProbe = document.createElement('div');
  gapProbe.style.cssText = 'position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px;';
  gapProbe.appendChild(document.createElement('div')).style.height = '1px';
  gapProbe.appendChild(document.createElement('div')).style.height = '1px';
  document.body.appendChild(gapProbe);
  document.documentElement.classList.toggle('no-flex-gap', gapProbe.scrollHeight !== 3);
  gapProbe.parentNode.removeChild(gapProbe);
  bootMark('layout-probe-done');
  var bridge = HubBridge.create(window.tizen);
  bootMark('bridge-created');
  var model = HubModel;
  var storage;
  try { storage = window.localStorage; } catch (_) { storage = { getItem: function () { throw new Error('Storage unavailable'); }, setItem: function () { throw new Error('Storage unavailable'); } }; }
  bootMark('storage-opened');
  var feedback = HubFeedback.create(window.tizen, storage);
  bootMark('feedback-created');
  var loaded = model.load(storage), favorites = loaded.apps;
  bootMark('model-loaded');
  var layoutKey = 'minimal-hub.layout.v1', compact = false;
  try { compact = storage.getItem(layoutKey) === 'compact'; } catch (_) { /* Default layout. */ }
  var fadeKey = 'minimal-hub.fade.v1', clockKey = 'minimal-hub.clock.v1', idleFade = true, clockFormat = 'off';
  try { idleFade = storage.getItem(fadeKey) !== 'off'; var savedClock = storage.getItem(clockKey); if (savedClock === '12h' || savedClock === '24h') { clockFormat = savedClock; } } catch (_) { /* Default appearance. */ }
  var idleTimer, clockTimer;
  var menu = document.querySelector('.bottom-menu'), clock = document.getElementById('home-clock');
  var catalog = [], catalogById = Object.create(null), discovered = false, discoveryError = '', discoveryBusy = false, discoveryRequest = 0;
  var homeSignature = '', resumeTimer, startupDiscoveryTimer;
  var mode = 'home', chosen = '', moving = null, moveIndex = 0;
  var busy = false, attempt = 0, launchTimer, motionTimer, lastHome = '';
  var launchingTile = null;
  var selectionKey = 'minimal-hub.selection.v1', startKey = 'minimal-hub.start.v1', startOnLast = true;
  var selectionTimer, savedSelection = '', selectionWarning = false;
  try { lastHome = savedSelection = storage.getItem(selectionKey) || ''; startOnLast = storage.getItem(startKey) !== 'first'; } catch (_) { /* Session focus still works without storage. */ }
  var holdKey = 'minimal-hub.hold.v1', holdToEdit = false, heldButton = null, holdTimer;
  try { holdToEdit = storage.getItem(holdKey) === 'on'; } catch (_) { /* Keep the immediate OK behavior. */ }
  var optionsOrigin = 'edit', removedShortcut = null;
  var nav = [];
  var grid = document.getElementById('favorites');
  var templates = {};
  Array.prototype.forEach.call(grid.children, function (node) { templates[HubBridge.apps[node.dataset.app].id] = node.cloneNode(true); });
  var editor = document.getElementById('editor'), list = document.getElementById('editor-list');
  var actions = document.getElementById('editor-actions'), title = document.getElementById('editor-title'), hint = document.getElementById('editor-hint');
  var edit = document.getElementById('edit-apps'), home = document.querySelector('[data-app="home"]'), emptyAdd = document.getElementById('empty-add');
  var settings = document.getElementById('settings'), settingsDialog = document.getElementById('settings-dialog');
  var resetDialog = document.getElementById('reset-dialog'), resetCancel = document.getElementById('reset-cancel'), resetConfirm = document.getElementById('reset-confirm');
  var launchDialog = document.getElementById('launch-error-dialog'), failedApp = null;
  var launchCancel = document.getElementById('launch-cancel'), launchRetry = document.getElementById('launch-retry'), launchHome = document.getElementById('launch-home');
  var telemetry = HubTelemetry.create(window.tizen, storage), telemetryBusy = false, telemetryGeneration = 0;
  var telemetrySetting = document.getElementById('setting-telemetry'), telemetryDialog = document.getElementById('telemetry-dialog');
  var telemetryEnabled = document.getElementById('telemetry-enabled'), telemetryEndpoint = document.getElementById('telemetry-endpoint');
  var telemetrySave = document.getElementById('telemetry-save'), telemetryCancel = document.getElementById('telemetry-cancel');
  var settingsDone = document.getElementById('settings-done'), soundSetting = document.getElementById('setting-sound');
  var layoutSetting = document.getElementById('setting-layout'), resetSetting = document.getElementById('setting-reset');
  var fadeSetting = document.getElementById('setting-fade'), clockSetting = document.getElementById('setting-clock');
  var startSetting = document.getElementById('setting-start'), settingsOptions = document.getElementById('settings-options');
  var holdSetting = document.getElementById('setting-hold'), undoRemove = document.getElementById('undo-remove');
  var moveBanner = document.getElementById('move-banner'), moveControls = document.getElementById('move-controls');
  var moveCancel = document.getElementById('move-cancel'), moveSave = document.getElementById('move-save');
  var settingsRows = [[settingsDone], [soundSetting], [layoutSetting], [fadeSetting], [clockSetting], [startSetting], [telemetrySetting], [resetSetting], [holdSetting]];
  var scrollBoxes = [grid, list, settingsOptions];
  function saveSelection() {
    clearTimeout(selectionTimer);
    if (!lastHome || lastHome === savedSelection) { return; }
    try { storage.setItem(selectionKey, lastHome); savedSelection = lastHome; }
    catch (_) {
      if (!selectionWarning && mode === 'home' && !busy && !document.getElementById('status').textContent) {
        message('Could not remember your selection after restarting Hub.', true); selectionWarning = true;
      }
    }
  }
  function rememberSelection(id) {
    lastHome = id; clearTimeout(selectionTimer);
    // Keep storage writes out of rapid arrow navigation; flush before leaving Hub.
    if (lastHome !== savedSelection) { selectionTimer = setTimeout(saveSelection, 250); }
  }
  function message(text, error) {
    var line = document.getElementById(mode === 'settings' || mode === 'reset' ? 'settings-status' : mode === 'move' ? 'move-status' : mode === 'home' ? 'status' : 'editor-status');
    line.textContent = text; line.classList.toggle('error', !!(text && error)); wakeMenu();
  }
  function canDim() { return idleFade && mode === 'home' && !document.hidden && favorites.length && !menu.contains(document.activeElement) && !document.getElementById('status').textContent; }
  function wakeMenu() {
    clearTimeout(idleTimer); menu.classList.remove('idle');
    if (canDim()) { idleTimer = setTimeout(function () { if (canDim()) { menu.classList.add('idle'); } }, 8000); }
  }
  function clockText() {
    var now = new Date(), hours = now.getHours(), minutes = String(now.getMinutes());
    if (minutes.length < 2) { minutes = '0' + minutes; }
    return clockFormat === '24h' ? (hours < 10 ? '0' : '') + hours + ':' + minutes : (hours % 12 || 12) + ':' + minutes + (hours < 12 ? ' AM' : ' PM');
  }
  function updateClock() {
    clearTimeout(clockTimer); clock.hidden = clockFormat === 'off' || mode === 'move';
    document.querySelector('main').classList.toggle('clock-on', !clock.hidden);
    if (clock.hidden || document.hidden) { return; }
    clock.textContent = clockText();
    if (mode === 'settings' && document.activeElement === clockSetting) { document.getElementById('setting-visual').textContent = clockText(); }
    clockTimer = setTimeout(updateClock, 60000 - Date.now() % 60000);
  }
  document.addEventListener('focusin', wakeMenu);
  document.addEventListener('pointerdown', wakeMenu, true);

  function find(id) { return catalogById[id]; }
  function focus(button) {
    if (!button || button === document.activeElement) { return; }
    button.focus({ preventScroll: true }); reveal(button);
  }
  // Instant scroll that keeps the 12px focus-ring gutter; scrollIntoView would clip the ring.
  function reveal(button) {
    var box = button.closest('.apps, .editor-list, .settings-options');
    if (!box || box.scrollHeight <= box.clientHeight) { return; }
    var frame = box.getBoundingClientRect(), item = button.getBoundingClientRect();
    if (item.top < frame.top + 12) { box.scrollTop -= frame.top + 12 - item.top; }
    else if (item.bottom > frame.bottom - 12) { box.scrollTop += item.bottom - frame.bottom + 12; }
    // The scroll event updates edge markers only when the viewport actually moves.
  }
  // Measure only the list ends, then update cues. Trailing padding is not more content.
  function edges(box) {
    var cue = document.getElementById(box.dataset.scrollCue);
    var frame = box.getBoundingClientRect(), first = box.firstElementChild, last = box.lastElementChild;
    var up = !!(frame.height && first && first.getBoundingClientRect().top < frame.top - 1);
    var down = !!(frame.height && last && last.getBoundingClientRect().bottom > frame.bottom + 1);
    cue.hidden = !(up || down);
    cue.classList.toggle('can-scroll-up', up); cue.classList.toggle('can-scroll-down', down);
  }
  function setNav(rows, target) {
    nav = rows.filter(function (row) { return row.length; });
    focus(target || (nav[0] && nav[0][0]));
    scrollBoxes.forEach(edges);
  }
  function keys(target, pairs) {
    target.textContent = '';
    pairs.forEach(function (pair) {
      var item = document.createElement('span'), key = document.createElement('kbd');
      key.textContent = pair[0]; item.appendChild(key); item.appendChild(document.createTextNode(pair[1])); target.appendChild(item);
    });
  }
  function note(text) {
    var p = document.createElement('p'); p.className = 'list-note'; p.textContent = text; list.appendChild(p);
  }
  function button(text, action, id) {
    var b = document.createElement('button'); b.type = 'button'; b.textContent = text;
    if (id) { b.dataset.id = id; }
    b.addEventListener('click', action); return b;
  }
  function commit(next) {
    try { favorites = model.save(storage, next); return true; }
    catch (_) { message('Could not save changes. Your previous list is unchanged. Free some TV storage and try again.', true); return false; }
  }
  function refresh(after) {
    clearTimeout(startupDiscoveryTimer); window.removeEventListener('focus', scheduleStartupDiscovery);
    if (discoveryBusy) { return; }
    bootMark('discovery-start');
    discoveryBusy = true;
    var request = ++discoveryRequest;
    var timeout = setTimeout(function () { finish(null, new Error('The TV did not return its app list.')); }, 8000);
    function finish(apps, error) {
      if (request !== discoveryRequest || !discoveryBusy) { return; }
      bootMark(error ? 'discovery-error' : 'discovery-result');
      clearTimeout(timeout); discoveryBusy = false;
      if (error) { discovered = false; discoveryError = 'Could not list installed apps. You can retry or use Samsung Home. ' + (error.name || error.message || ''); }
      else {
        catalog = apps; catalogById = Object.create(null);
        catalog.forEach(function (app) { catalogById[app.id] = app; });
        discovered = true; discoveryError = '';
      }
      if (after) { after(); }
      bootMark('discovery-render-done');
    }
    bridge.discover(function (apps) { finish(apps); }, function (error) { finish(null, error); });
    bootMark('discovery-call-returned');
  }
  function resetLaunchMotion() {
    clearTimeout(motionTimer);
    if (!grid.classList.contains('launch-motion')) { return; }
    Array.prototype.forEach.call(grid.children, function (tile) {
      tile.classList.remove('launch-selected'); tile.style.transform = ''; tile.style.opacity = ''; tile.style.zIndex = '';
    });
    grid.classList.remove('launch-motion', 'launch-contained');
  }
  function animateLaunch(id) {
    resetLaunchMotion();
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return; }
    var selected = Array.prototype.filter.call(grid.children, function (tile) { return tile.dataset.id === id; })[0];
    if (!selected) { return; }
    var viewport = grid.getBoundingClientRect(), stage = grid.parentElement.getBoundingClientRect(), box = selected.getBoundingClientRect();
    var scrolling = grid.scrollHeight > grid.clientHeight + 1;
    var area = scrolling ? viewport : { left: stage.left + 12, right: stage.right - 12, top: stage.top + 12, bottom: stage.bottom - 12, width: stage.width - 24, height: stage.height - 24 };
    grid.classList.toggle('launch-contained', scrolling);
    var scale = Math.max(1, Math.min(1.12, (area.width - 16) / box.width, (area.height - 16) / box.height));
    var dx = box.width * (scale - 1) / 2, dy = box.height * (scale - 1) / 2;
    var x = Math.max(area.left + 8 - (box.left - dx), Math.min(0, area.right - 8 - (box.right + dx)));
    var y = Math.max(area.top + 8 - (box.top - dy), Math.min(0, area.bottom - 8 - (box.bottom + dy)));
    grid.classList.add('launch-motion'); selected.classList.add('launch-selected');
    selected.style.zIndex = '2'; selected.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
    Array.prototype.forEach.call(grid.children, function (tile) {
      if (tile === selected) { return; }
      var other = tile.getBoundingClientRect(), sameRow = Math.abs(other.top - box.top) < box.height / 2;
      tile.style.transform = sameRow ? 'translateX(' + ((other.left < box.left ? -1 : 1) * (dx + Math.abs(x) + 16)) + 'px)' : 'translateY(' + ((other.top < box.top ? -1 : 1) * (dy + Math.abs(y) + 12)) + 'px)';
      tile.style.opacity = '.45';
    });
    motionTimer = setTimeout(resetLaunchMotion, 1200);
  }
  function launch(app) {
    if (busy) { return; }
    cancelHold();
    busy = true; var current = ++attempt, accepted = false; animateLaunch(app.id); message('Opening ' + app.name + '… · Back to dismiss');
    launchingTile = Array.prototype.filter.call(grid.children, function (tile) { return tile.dataset.id === app.id; })[0] || null;
    if (launchingTile) {
      var label = document.createElement('span'); label.className = 'launch-label'; label.textContent = 'Opening ' + app.name + '…'; label.setAttribute('aria-hidden', 'true');
      launchingTile.setAttribute('aria-busy', 'true'); launchingTile.appendChild(label);
    }
    function finish(text, failed) {
      if (current !== attempt) { return; }
      ++attempt; clearTimeout(launchTimer); busy = false; clearLaunchLabel();
      if (mode !== 'home' || document.hidden) { return; }
      message(failed ? '' : text);
      if (failed) { showLaunchError(app, text); }
    }
    launchTimer = setTimeout(function () { finish(accepted ? 'The TV accepted the request, but Hub is still on screen. You can try again.' : app.name + ' did not respond. You can try again.', true); }, 10000);
    bridge.launchApp(app, function (result) {
      if (current !== attempt) { return; }
      if (result.preview) { finish('Preview: ' + result.name + ' would open on the TV.'); }
      // Samsung Home can open as a partial overlay without hiding Hub (QN90A).
      else if (app.id === HubBridge.apps.home.id) { finish(''); }
      else { accepted = true; } // API acceptance is not proof that the foreground has changed.
    }, function () {
      finish('Try again, or choose another app from Samsung Home.', true);
    });
  }
  function clearLaunchLabel() {
    if (!launchingTile) { return; }
    var label = launchingTile.querySelector('.launch-label'); if (label) { label.remove(); }
    launchingTile.removeAttribute('aria-busy'); launchingTile = null;
  }
  function cancelLaunch() {
    if (busy && mode === 'home') { message(''); }
    ++attempt; clearTimeout(launchTimer); busy = false; clearLaunchLabel(); resetLaunchMotion();
  }
  function showLaunchError(app, detail) {
    resetLaunchMotion(); failedApp = app; mode = 'launch-error'; launchDialog.hidden = false;
    document.getElementById('launch-error-title').textContent = 'Could not open ' + app.name;
    document.getElementById('launch-error-detail').textContent = app.id === HubBridge.apps.home.id ? 'Try again, or press Back to return to your apps.' : detail;
    launchHome.hidden = app.id === HubBridge.apps.home.id;
    setNav([launchHome.hidden ? [launchCancel, launchRetry] : [launchCancel, launchRetry, launchHome]], launchCancel);
  }
  function closeLaunchError() {
    var target = failedApp && failedApp.id === HubBridge.apps.home.id ? 'home' : failedApp && failedApp.id;
    renderHome(target || lastHome); message('');
  }
  launchCancel.addEventListener('click', closeLaunchError);
  launchRetry.addEventListener('click', function () { var app = failedApp; closeLaunchError(); if (app) { launch(app); } });
  launchHome.addEventListener('click', function () { closeLaunchError(); launch(HubBridge.apps.home); });
  function appTile(app) {
    var b;
      if (templates[app.id]) { b = templates[app.id].cloneNode(true); }
      else {
        var look = HubPresentation.get(app);
        b = document.createElement('button'); b.className = 'tile branded ' + look.theme;
        var art = document.createElement('span'); art.className = 'brand-art'; art.setAttribute('aria-hidden', 'true');
        var shape = document.createElement('span'); shape.className = 'brand-shape'; art.appendChild(shape);
        var logo = document.createElement('span'); logo.className = 'brand-wordmark'; logo.textContent = look.wordmark;
        if (look.wordmark.length > 14) { logo.classList.add('long'); }
        if (!look.custom && app.icon) {
          var img = document.createElement('img'); img.className = 'brand-icon'; img.alt = ''; img.src = app.icon;
          img.onerror = function () { img.remove(); }; b.appendChild(img);
        }
        b.appendChild(art); b.appendChild(logo);
      }
    return b;
  }
  function previewApp(app, detail) {
    var art = document.getElementById('preview-art'); art.textContent = '';
    if (app) {
      var tile = appTile(find(app.id) || app), card = document.createElement('div'); card.className = tile.className;
      while (tile.firstChild) { card.appendChild(tile.firstChild); } art.appendChild(card);
    }
    document.getElementById('preview-name').textContent = app ? app.name : 'Room for your favorites';
    document.getElementById('preview-detail').textContent = detail || 'Choose Add apps to get started.';
    document.getElementById('app-preview').classList.toggle('empty-preview', !app); document.getElementById('app-preview').classList.remove('failed');
  }
  function row(badge, name, detail, action, id) {
    var b = button('', action, id); b.className = 'app-row';
    [['row-badge', badge], ['row-name', name], ['row-state', detail]].forEach(function (part) {
      var span = document.createElement('span'); span.className = part[0]; span.textContent = part[1]; b.appendChild(span);
    });
    return b;
  }
  function appRow(app, badge, detail, action) {
    var b = row(badge, app.name, detail, action, app.id);
    b.classList.add(templates[app.id] ? templates[app.id].dataset.app : HubPresentation.get(app).theme);
    b.addEventListener('focus', function () { previewApp(app, b.classList.contains('missing') ? 'No longer installed on this TV. Press OK to remove its shortcut.' : mode === 'picker' ? (b.getAttribute('aria-pressed') === 'true' ? 'Already on Home' : 'Press OK to add to Home') : mode === 'move' ? 'Move with the arrows · OK to save' : 'Press OK to move or remove'); });
    return b;
  }
  function renderHome(target, forMove) {
    cancelHold();
    launchDialog.hidden = true; failedApp = null;
    telemetryDialog.hidden = true;
    resetLaunchMotion(); mode = forMove ? 'move' : 'home'; editor.hidden = true; settingsDialog.hidden = true; resetDialog.hidden = true;
    var apps = forMove ? moving : favorites;
    var signature = JSON.stringify([compact, !!forMove, apps.map(function (saved) { var app = find(saved.id); return [saved.id, app ? app.name : saved.name, app && app.icon, discovered && !app]; })]);
    if (signature !== homeSignature) {
      grid.textContent = ''; homeSignature = signature;
      apps.forEach(function (saved) {
      var installed = find(saved.id), app = installed || saved, b;
      b = appTile(app);
      b.dataset.id = saved.id; b.setAttribute('aria-label', (forMove ? 'Move ' : 'Open ') + app.name);
      if (discovered && !installed) {
        b.classList.add('unavailable'); var label = document.createElement('span'); label.className = 'unavailable-label'; label.textContent = 'Unavailable · Edit apps to remove'; b.appendChild(label);
      }
      b.addEventListener('focus', function () { if (mode === 'home') { rememberSelection(saved.id); } });
      b.addEventListener('click', function () { if (mode === 'move') { if (saved.id === chosen) { finishMove(); } } else { launch(find(saved.id) || saved); } }); grid.appendChild(b);
      });
    }
    var tiles = Array.prototype.slice.call(grid.children);
    var columns = Math.min(apps.length || 2, compact ? 4 : 3), rows = [];
    grid.classList.toggle('many', columns >= 3); grid.classList.toggle('compact', columns === 4); grid.classList.toggle('single', favorites.length === 1);
    grid.classList.toggle('reordering', !!forMove);
    for (var i = 0; i < tiles.length; i += columns) { rows.push(tiles.slice(i, i + columns)); }
    if (!tiles.length) { rows.push([emptyAdd]); }
    undoRemove.hidden = !removedShortcut;
    rows.push(removedShortcut ? [edit, home, settings, undoRemove] : [edit, home, settings]);
    menu.hidden = !!forMove; moveBanner.hidden = !forMove; moveControls.hidden = !forMove;
    keys(document.getElementById('home-hint'), holdToEdit ? [['↑ ↓ ← →', 'Choose'], ['OK', 'Open'], ['Hold OK', 'Edit']] : [['↑ ↓ ← →', 'Choose'], ['OK', 'Open']]);
    grid.hidden = !tiles.length; document.getElementById('empty-home').hidden = !!tiles.length;
    var selected = tiles.filter(function (b) { return b.dataset.id === target; })[0];
    if (forMove) {
      selected.classList.add('moving'); selected.tabIndex = 0;
      tiles.forEach(function (b) { if (b !== selected) { b.tabIndex = -1; b.setAttribute('aria-disabled', 'true'); } });
      var badge = document.createElement('span'); badge.className = 'move-label'; badge.textContent = 'Moving'; selected.appendChild(badge);
      document.getElementById('move-title').textContent = 'Move ' + moving[moveIndex].name;
      updateMovePosition(); setNav([[selected], [moveCancel, moveSave]], selected);
    } else {
      setNav(rows, target === 'edit' ? edit : target === 'settings' ? settings : target === 'home' ? home : target === 'undo' && removedShortcut ? undoRemove : selected);
    }
    wakeMenu(); updateClock();
  }
  function editorFrame(name, help) {
    editor.hidden = false; editor.dataset.mode = mode; title.textContent = name; keys(hint, help);
    document.getElementById('editor-count').textContent = mode !== 'picker' ? favorites.length + (favorites.length === 1 ? ' shortcut on Home' : ' shortcuts on Home') :
      discovered ? catalog.length + ' installed · ' + favorites.length + ' on Home' : '';
    list.textContent = ''; actions.textContent = ''; document.getElementById('editor-status').textContent = '';
  }
  function renderEdit(target) {
    cancelHold(); menu.hidden = false; moveBanner.hidden = true; moveControls.hidden = true;
    mode = 'edit'; moving = null;
    editorFrame('Edit apps', [['↑ ↓', 'Choose'], ['OK', 'Move or remove'], ['Back', 'Home']]);
    previewApp(favorites.filter(function (a) { return a.id === target; })[0] || favorites[0], favorites.length ? 'Your apps, in your order' : '');
    var add = button('Add apps', openPicker), done = button('Done', function () { renderHome('edit'); });
    actions.appendChild(add); actions.appendChild(done);
    var toolbar = [add, done];
    if (removedShortcut) { var undo = button('Undo remove', undoRemoval); actions.appendChild(undo); toolbar.push(undo); }
    var rows = favorites.map(function (app, i) {
      var b = appRow(app, String(i + 1), '', function () { chosen = app.id; renderOptions(); });
      list.appendChild(b); return [b];
    });
    markMissing();
    setNav([toolbar].concat(rows), rows.map(function (r) { return r[0]; }).filter(function (b) { return b.dataset.id === target; })[0]);
    if (!favorites.length) { note('No shortcuts yet. Choose Add apps to fill your Home.'); }
  }
  function markMissing() {
    Array.prototype.forEach.call(list.querySelectorAll('.app-row'), function (b, i) {
      var gone = discovered && favorites[i] && !find(favorites[i].id);
      b.classList.toggle('missing', !!gone); b.querySelector('.row-state').textContent = gone ? 'Unavailable' : '';
    });
  }
  function openEditor() {
    cancelLaunch();
    renderEdit();
    refresh(function () { if (mode === 'edit') {
        // Discovery must never steal focus while the user navigates the toolbar.
        markMissing();
        if (discoveryError) { message(discoveryError, true); }
      } else if (mode === 'picker') { refreshedPicker(); } });
  }
  function openPicker() {
    cancelLaunch();
    mode = 'picker'; renderPicker();
    message('Checking installed apps…');
    // An editor refresh may already be running; its callback renders the picker too.
    if (discoveryBusy) { return; }
    refresh(function () { if (mode === 'picker') { refreshedPicker(); } });
  }
  // A late app list keeps focus and must not wipe a confirmation such as "added to Home".
  function refreshedPicker() {
    var line = document.getElementById('editor-status'), kept = line.textContent, error = line.classList.contains('error');
    renderPicker(document.activeElement.dataset.id);
    if (kept && kept !== 'Checking installed apps…' && !discoveryError) { message(kept, error); }
  }
  function renderPicker(target) {
    mode = 'picker'; editorFrame('Add apps', [['↑ ↓', 'Browse'], ['OK', 'Add to Home'], ['Back', 'Edit apps']]);
    previewApp(null, discoveryError ? 'Refresh the list to try again.' : 'Installed apps appear here.');
    if (discoveryError) { document.getElementById('preview-name').textContent = 'App list unavailable'; }
    document.getElementById('app-preview').classList.toggle('failed', !!discoveryError);
    var back = button('Back to Edit apps', function () { renderEdit(); }), retry = button('Refresh list', openPicker);
    actions.appendChild(back); actions.appendChild(retry);
    var rows = (discovered ? catalog : []).map(function (app) {
      var added = favorites.some(function (a) { return a.id === app.id; });
      var b = appRow(app, added ? '✓' : '+', added ? 'On Home' : '', function () {
        if (favorites.some(function (a) { return a.id === app.id; })) { message(app.name + ' is already on Home.'); return; }
        if (favorites.length >= 256) { message('Home is full. Remove a shortcut first.', true); return; }
        if (commit(favorites.concat([app]))) { renderPicker(app.id); message(app.name + ' added to Home.'); }
      });
      b.setAttribute('aria-pressed', String(added)); list.appendChild(b); return [b];
    });
    // An empty list explains itself in place; a failed one offers the retry first.
    if (!rows.length) { note(discoveryError ? 'The TV did not share its app list. Choose Refresh list to try again. Samsung Home is still available from the Home screen.' : discovered ? 'No apps are available to add. Samsung Home is available from the Home screen.' : 'Checking installed apps…'); }
    setNav([[back, retry]].concat(rows), rows.map(function (r) { return r[0]; }).filter(function (b) { return b.dataset.id === target; })[0] || (rows[0] && rows[0][0]) || (discoveryError ? retry : back));
    if (discoveryError) { message(discoveryError, true); }
    if (bridge.preview) { message('Desktop preview only. Installed apps are discovered on the TV.'); }
  }
  function renderOptions(origin) {
    cancelHold(); optionsOrigin = origin || 'edit';
    var app = favorites.filter(function (a) { return a.id === chosen; })[0];
    if (!app) { renderEdit(); return; }
    mode = 'options'; editorFrame(app.name, [['↑ ↓', 'Choose'], ['OK', 'Select'], ['Back', optionsOrigin === 'home' ? 'Home' : 'Edit apps']]);
    previewApp(app, 'Pick a new position with the arrows, then press OK to save.');
    var move = row('↕', 'Move', 'Change its place on Home', function () { moving = favorites.slice(); moveIndex = favorites.findIndex(function (a) { return a.id === chosen; }); renderMove(); });
    var remove = row('−', 'Remove from Home', 'The app stays installed', function () {
      var index = favorites.findIndex(function (a) { return a.id === chosen; });
      if (commit(favorites.filter(function (a) { return a.id !== chosen; }))) {
        removedShortcut = { app: app, index: index }; returnFromOptions(); message(app.name + ' removed. Choose Undo remove to restore it.');
      }
    });
    var cancel = row('←', 'Back', '', returnFromOptions);
    remove.classList.add('danger');
    [[move, 'Pick a new position with the arrows, then press OK to save.'], [remove, 'Removing this shortcut keeps the app installed. Add it again any time.'], [cancel, 'Return to your shortcuts without changes.']].forEach(function (item) {
      item[0].addEventListener('focus', function () { document.getElementById('preview-detail').textContent = item[1]; }); list.appendChild(item[0]);
    });
    setNav([[move], [remove], [cancel]]);
  }
  function renderMove() {
    renderHome(chosen, true); message('');
  }
  function updateMovePosition() { document.getElementById('move-position').textContent = 'Position ' + (moveIndex + 1) + ' of ' + moving.length; }
  function returnFromOptions() {
    homeSignature = ''; moving = null;
    if (optionsOrigin === 'home') { renderHome(chosen); } else { renderEdit(chosen); }
  }
  function finishMove() { if (moving && commit(moving)) { returnFromOptions(); message('New order saved.'); } }
  function undoRemoval() {
    if (!removedShortcut) { return; }
    var entry = removedShortcut, next = favorites.slice();
    if (!next.some(function (app) { return app.id === entry.app.id; })) {
      if (next.length >= 256) { message('Home is full. Remove a shortcut before restoring this one.', true); return; }
      next.splice(Math.min(entry.index, next.length), 0, entry.app);
    }
    if (commit(next)) {
      removedShortcut = null;
      if (mode === 'home') { renderHome(entry.app.id); } else { renderEdit(entry.app.id); }
      message(entry.app.name + ' restored.');
    }
  }
  moveCancel.addEventListener('click', returnFromOptions); moveSave.addEventListener('click', finishMove);
  undoRemove.addEventListener('click', undoRemoval);
  function settingPreview(which) {
    var visual = document.getElementById('setting-visual'), name, detail;
    visual.textContent = ''; visual.className = which;
    if (which === 'setting-hold') {
      name = holdToEdit ? 'Edit from your Home screen' : 'Open immediately with OK';
      detail = holdToEdit ? 'Tap OK to open. Hold for a moment to move or remove a shortcut. Edit apps is always available.' : 'Turn on to hold OK for shortcut actions. Leave off if your remote does not support holding OK.';
      visual.textContent = holdToEdit ? 'Hold OK' : 'Off';
    } else if (which === 'setting-telemetry') {
      name = 'TV performance, on your server'; detail = 'Choose the paired receiver and pause or resume monitoring. Changes apply without restarting the TV.'; visual.textContent = 'Netdata';
    } else if (which === 'setting-start') {
      name = startOnLast ? 'Pick up where you left off' : 'A familiar starting point';
      detail = startOnLast ? 'Select your last highlighted app when Hub starts. Your app order stays the same.' : 'Select the first favorite when Hub starts. Returning from an app still restores your selection.';
      visual.textContent = startOnLast ? 'Last selected' : 'First favorite';
    } else if (which === 'setting-clock') {
      name = clockFormat === 'off' ? 'Time, only if you want it' : 'Just the time';
      detail = 'Off, 12-hour or 24-hour. Uses your TV’s local time, with no seconds or extra clutter.';
      visual.textContent = clockFormat === 'off' ? '—:—' : clockText();
    } else if (which === 'setting-fade') {
      name = idleFade ? 'Quieter after eight seconds' : 'Controls stay visible';
      detail = 'Any remote press restores the menu immediately. Focused controls and messages always stay visible.';
      visual.classList.toggle('dim-preview', idleFade);
      ['Edit apps', 'Samsung Home', '⚙'].forEach(function (label) { var pill = document.createElement('span'); pill.textContent = label; visual.appendChild(pill); });
    } else if (which === 'setting-layout') {
      name = compact ? 'More apps at a glance' : 'A little more breathing room';
      detail = compact ? 'Up to four tiles in each row.' : 'Up to three tiles in each row.';
      visual.classList.toggle('dense', compact);
      for (var i = 0; i < (compact ? 8 : 6); i++) { var cell = document.createElement('span'); visual.appendChild(cell); }
    } else if (which === 'setting-reset') {
      name = 'A fresh start'; detail = 'Restore Plex and YouTube. You’ll confirm before anything changes.';
      var pair = document.createElement('span'); pair.className = 'reset-pair'; pair.textContent = 'Plex  +  YouTube'; visual.appendChild(pair);
    } else {
      name = feedback.enabled() ? 'A little reassurance' : 'Keep it quiet';
      detail = feedback.enabled() ? 'Gentle cues for moving, selecting, and going back.' : 'Visual focus stays instant. Navigation sounds are off.';
      visual.classList.toggle('quiet', !feedback.enabled());
      for (var j = 0; j < 9; j++) { var bar = document.createElement('span'); bar.style.height = (j % 4 === 0 ? 28 : j % 3 === 0 ? 68 : 46) + '%'; visual.appendChild(bar); }
    }
    document.getElementById('setting-preview-title').textContent = name;
    document.getElementById('setting-preview-detail').textContent = detail;
  }
  [soundSetting, layoutSetting, fadeSetting, clockSetting, startSetting, telemetrySetting, resetSetting, holdSetting].forEach(function (b) { b.addEventListener('focus', function () { settingPreview(b.id); }); });
  function openSettings(target) {
    cancelHold(); cancelLaunch();
    telemetryDialog.hidden = true; mode = 'settings'; editor.hidden = true; resetDialog.hidden = true; settingsDialog.hidden = false;
    document.getElementById('sound-value').textContent = feedback.enabled() ? 'On' : 'Off';
    soundSetting.setAttribute('aria-pressed', String(feedback.enabled()));
    document.getElementById('layout-value').textContent = compact ? 'Compact' : 'Comfortable';
    document.getElementById('fade-value').textContent = idleFade ? 'Auto-dim' : 'Always visible';
    fadeSetting.setAttribute('aria-pressed', String(idleFade));
    document.getElementById('clock-value').textContent = clockFormat === 'off' ? 'Off' : clockFormat === '12h' ? '12-hour' : '24-hour';
    document.getElementById('start-value').textContent = startOnLast ? 'Last selected' : 'First favorite';
    document.getElementById('hold-value').textContent = holdToEdit ? 'On' : 'Off'; holdSetting.setAttribute('aria-pressed', String(holdToEdit));
    document.getElementById('settings-status').textContent = '';
    setNav(settingsRows, target || soundSetting);
    settingPreview((target || soundSetting).id);
  }
  function showMonitoring(enabled) {
    telemetryEnabled.setAttribute('aria-pressed', String(enabled)); document.getElementById('telemetry-value').textContent = enabled ? 'On' : 'Off';
  }
  function telemetryNote(text, error) { var line = document.getElementById('telemetry-status'); line.textContent = text; line.classList.toggle('error', !!error); }
  telemetrySetting.addEventListener('click', function () {
    var generation = ++telemetryGeneration;
    mode = 'telemetry'; telemetryDialog.hidden = false; telemetryBusy = true; telemetrySave.disabled = true;
    telemetryNote('Loading preferences…');
    setNav([[telemetryEnabled], [telemetryEndpoint], [telemetryCancel, telemetrySave]], telemetryCancel);
    telemetry.load(function (value) {
      if (mode !== 'telemetry' || generation !== telemetryGeneration) { return; }
      telemetryBusy = false; telemetrySave.disabled = false; telemetryEndpoint.value = value.endpoint;
      showMonitoring(value.enabled); telemetryNote(''); focus(telemetryEnabled);
    }, function () { if (mode === 'telemetry' && generation === telemetryGeneration) { telemetryNote('Monitoring preferences are unavailable on this TV.', true); } });
  });
  telemetryEnabled.addEventListener('click', function () {
    if (!telemetryBusy) { showMonitoring(telemetryEnabled.getAttribute('aria-pressed') !== 'true'); }
  });
  telemetrySave.addEventListener('click', function () {
    if (telemetryBusy) { return; } telemetryBusy = true; telemetrySave.disabled = true;
    var generation = telemetryGeneration;
    telemetry.save({ schema: 1, enabled: telemetryEnabled.getAttribute('aria-pressed') === 'true', endpoint: telemetryEndpoint.value.trim() }, function () {
      if (mode !== 'telemetry' || generation !== telemetryGeneration) { return; }
      telemetryBusy = false; telemetrySave.disabled = false; openSettings(telemetrySetting); message('Monitoring preferences saved. Changes apply within 10 seconds.');
    }, function (error) { if (mode !== 'telemetry' || generation !== telemetryGeneration) { return; } telemetryBusy = false; telemetrySave.disabled = false; telemetryNote(error.message || 'Could not save monitoring preferences.', true); });
  });
  telemetryCancel.addEventListener('click', function () { if (!telemetryBusy || telemetrySave.disabled) { openSettings(telemetrySetting); } });
  settings.addEventListener('click', function () { openSettings(); });
  settingsDone.addEventListener('click', function () { renderHome('settings'); });
  soundSetting.addEventListener('click', function () {
    try { feedback.toggle(); openSettings(soundSetting); }
    catch (_) { message('Could not save the sound preference. Your setting is unchanged.', true); }
  });
  layoutSetting.addEventListener('click', function () {
    try { storage.setItem(layoutKey, compact ? 'comfortable' : 'compact'); compact = !compact; openSettings(layoutSetting); }
    catch (_) { message('Could not save the layout. Your setting is unchanged.', true); }
  });
  fadeSetting.addEventListener('click', function () {
    try { storage.setItem(fadeKey, idleFade ? 'off' : 'on'); idleFade = !idleFade; openSettings(fadeSetting); wakeMenu(); }
    catch (_) { message('Could not save the menu preference. Your setting is unchanged.', true); }
  });
  clockSetting.addEventListener('click', function () {
    var next = clockFormat === 'off' ? '12h' : clockFormat === '12h' ? '24h' : 'off';
    try { storage.setItem(clockKey, next); clockFormat = next; updateClock(); openSettings(clockSetting); }
    catch (_) { message('Could not save the clock preference. Your setting is unchanged.', true); }
  });
  startSetting.addEventListener('click', function () {
    try { storage.setItem(startKey, startOnLast ? 'first' : 'last'); startOnLast = !startOnLast; openSettings(startSetting); }
    catch (_) { message('Could not save the starting app preference. Your setting is unchanged.', true); }
  });
  holdSetting.addEventListener('click', function () {
    try { storage.setItem(holdKey, holdToEdit ? 'off' : 'on'); holdToEdit = !holdToEdit; openSettings(holdSetting); }
    catch (_) { message('Could not save the hold preference. Your setting is unchanged.', true); }
  });
  resetSetting.addEventListener('click', function () { mode = 'reset'; resetDialog.hidden = false; setNav([[resetCancel, resetConfirm]]); });
  resetCancel.addEventListener('click', function () { openSettings(resetSetting); });
  resetConfirm.addEventListener('click', function () {
    if (commit(model.defaults)) { removedShortcut = null; openSettings(resetSetting); message('Home restored to Plex and YouTube.'); }
    else { resetDialog.hidden = true; mode = 'settings'; setNav(settingsRows, resetSetting); }
  });
  function back() {
    if (mode === 'launch-error') { closeLaunchError(); }
    else if (mode === 'telemetry') { openSettings(telemetrySetting); }
    else if (mode === 'reset') { openSettings(resetSetting); }
    else if (mode === 'settings') { renderHome('settings'); }
    else if (mode === 'move' || mode === 'options') { returnFromOptions(); }
    else if (mode === 'picker') { renderEdit(); }
    else if (mode === 'edit') { renderHome('edit'); }
    else if (mode === 'home' && busy) { cancelLaunch(); }
    // Back on Home never requests exit.
  }
  function cancelHold() { clearTimeout(holdTimer); if (heldButton) { heldButton.classList.remove('pressed'); } heldButton = null; }
  function activate(b) {
    b.classList.add('pressed'); setTimeout(function () { b.classList.remove('pressed'); }, 120); feedback.play('SELECT'); b.click();
  }
  document.addEventListener('focusin', function () { if (heldButton && heldButton !== document.activeElement) { cancelHold(); } });
  window.addEventListener('blur', cancelHold);
  edit.addEventListener('click', openEditor);
  emptyAdd.addEventListener('click', openPicker);
  scrollBoxes.forEach(function (box) { box.addEventListener('scroll', function () { edges(box); }); });
  window.addEventListener('resize', function () { scrollBoxes.forEach(edges); });
  home.addEventListener('click', function () { launch(HubBridge.apps.home); });
  document.addEventListener('keydown', function (event) {
    wakeMenu();
    var key = event.key || ({ 37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown', 13: 'Enter' })[event.keyCode];
    if (event.keyCode === 10009 || key === 'Escape' || key === 'Back' || key === 'GoBack') { cancelHold(); event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) { back(); feedback.play('BACK'); } return; }
    if (mode === 'telemetry' && document.activeElement === telemetryEndpoint && (key === 'Enter' || key === 'ArrowLeft' || key === 'ArrowRight')) { return; }
    if (key === 'Enter') {
      event.preventDefault();
      if (event.repeat || heldButton || document.activeElement.tagName !== 'BUTTON') { return; }
      var activated = document.activeElement;
      if (holdToEdit && mode === 'home' && grid.contains(activated) && !busy) {
        heldButton = activated; heldButton.classList.add('pressed');
        holdTimer = setTimeout(function () {
          if (heldButton !== activated || document.activeElement !== activated || document.hidden || mode !== 'home') { cancelHold(); return; }
          chosen = activated.dataset.id; cancelHold(); feedback.play('SELECT'); renderOptions('home');
        }, 650);
      } else { activate(activated); }
      return;
    }
    cancelHold();
    if (mode === 'move' && grid.contains(document.activeElement) && /^Arrow/.test(key)) {
      event.preventDefault();
      var columns = Math.min(moving.length, compact ? 4 : 3), lengths = [];
      for (var offset = 0; offset < moving.length; offset += columns) { lengths.push(Math.min(columns, moving.length - offset)); }
      var currentRow = Math.floor(moveIndex / columns);
      if (key === 'ArrowDown' && currentRow === lengths.length - 1) { focus(moveCancel); feedback.play('MOVE'); return; }
      var cell = model.navigate(lengths, currentRow, moveIndex % columns, key), next = cell[0] * columns + cell[1];
      if (next === moveIndex) { return; }
      var tile = grid.children[moveIndex];
      grid.insertBefore(tile, next > moveIndex ? grid.children[next].nextSibling : grid.children[next]);
      moving = model.move(moving, moveIndex, next);
      moveIndex = next; homeSignature = '';
      // The same focused node moves, avoiding a full list rebuild per key.
      focus(tile); reveal(tile); edges(grid); updateMovePosition();
      feedback.play('MOVE'); return;
    }
    // ponytail: options were once a horizontal row; left/right remain aliases for up/down.
    if (mode === 'options') { key = key === 'ArrowRight' ? 'ArrowDown' : key === 'ArrowLeft' ? 'ArrowUp' : key; }
    var flat = [].concat.apply([], nav);
    if (key === 'Tab') { event.preventDefault(); var index = flat.indexOf(document.activeElement); focus(flat[(index + (event.shiftKey ? -1 : 1) + flat.length) % flat.length]); return; }
    if (!/^Arrow/.test(key)) { return; }
    event.preventDefault(); var row = 0, col = 0;
    nav.forEach(function (r, i) { var j = r.indexOf(document.activeElement); if (j >= 0) { row = i; col = j; } });
    var position = model.navigate(nav.map(function (r) { return r.length; }), row, col, key); var target = nav[position[0]][position[1]];
    if (target !== document.activeElement) { focus(target); feedback.play('MOVE'); }
  });
  // Consume release as well so repeated remote Back events never request exit.
  document.addEventListener('keyup', function (event) {
    if (event.keyCode === 10009 || /^(Escape|Back|GoBack)$/.test(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); }
    if (event.key === 'Enter' || event.keyCode === 13) {
      event.preventDefault();
      if (heldButton) { var released = heldButton; cancelHold(); if (mode === 'home' && released === document.activeElement && !document.hidden) { activate(released); } }
    }
  }, true);
  document.addEventListener('visibilitychange', function () {
    clearTimeout(resumeTimer); cancelHold(); saveSelection(); cancelLaunch(); wakeMenu(); updateClock();
    if (!document.hidden) {
      var saved = model.load(storage); favorites = saved.apps; moving = null; renderHome(lastHome); message(saved.warning, true);
      // Give the restored screen a frame before asking the platform for its catalog.
      resumeTimer = setTimeout(function () { refresh(function () { if (mode === 'home') { refreshedHome(); } else if (mode === 'picker') { refreshedPicker(); } else if (mode === 'edit') { markMissing(); } }); }, 150);
    }
  });
  window.addEventListener('pagehide', saveSelection);
  function refreshedHome() {
    if (mode !== 'home' || busy || heldButton) { return; }
    var active = document.activeElement;
    renderHome(active === edit ? 'edit' : active === settings ? 'settings' : active === home ? 'home' : active === undoRemove ? 'undo' : lastHome);
  }
  bootMark('handlers-attached');
  document.getElementById('preview').hidden = !bridge.preview; renderHome(startOnLast ? lastHome : ''); message(loaded.warning, true);
  bootMark('initial-dom-render');
  if (window.HubNativePlatform && window.HubNativePlatform.ready) { window.HubNativePlatform.ready(); }
  if (window.HubBootTrace && window.requestAnimationFrame) { requestAnimationFrame(function () { bootMark('render-frame-1'); requestAnimationFrame(function () { bootMark('render-frame-2'); }); }); }
  function scheduleStartupDiscovery() {
    if (document.hidden || (document.hasFocus && !document.hasFocus())) { return; }
    clearTimeout(startupDiscoveryTimer);
    startupDiscoveryTimer = setTimeout(function () {
      refresh(function () { if (mode === 'home') { refreshedHome(); } else if (mode === 'picker') { refreshedPicker(); } });
    }, 0);
  }
  window.addEventListener('focus', scheduleStartupDiscovery); scheduleStartupDiscovery();
}());

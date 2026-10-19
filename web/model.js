/* Persistent shortcuts and deterministic remote navigation; no device I/O. */
(function (root) {
  'use strict';
  var KEY = 'minimal-hub.shortcuts.v1';
  var HOME = 'com.samsung.tv.csfs';
  var SELF = 'MiniHub001.Hub';
  var defaults = [{ id: 'kIciSQlYEM.plex', name: 'Plex' }, { id: '9Ur5IzDKqV.TizenYouTube', name: 'YouTube' }];
  function valid(app) {
    return app && typeof app.id === 'string' && /^[A-Za-z0-9_.-]{1,256}$/.test(app.id) &&
      app.id !== HOME && app.id !== SELF && typeof app.name === 'string' && app.name.trim().length > 0;
  }
  function clean(apps) {
    var seen = Object.create(null);
    return apps.filter(function (app) {
      if (!valid(app) || seen[app.id]) { return false; }
      seen[app.id] = true; return true;
    }).slice(0, 256).map(function (app) { return { id: app.id, name: app.name.trim().slice(0, 120) }; });
  }
  function load(storage) {
    try {
      var raw = storage.getItem(KEY);
      if (raw === null) { return { apps: clean(defaults), warning: '' }; }
      var saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || !Array.isArray(saved.apps) || saved.apps.length > 256) {
        throw new Error('Invalid saved shortcuts');
      }
      var apps = clean(saved.apps);
      return { apps: apps, warning: apps.length < saved.apps.length ? 'Some saved apps were invalid or duplicated and were skipped.' : '' };
    } catch (error) { return { apps: clean(defaults), warning: 'Saved apps could not be read. Showing Plex and YouTube. Your next edit will replace the saved list.' }; }
  }
  function save(storage, apps) {
    var next = clean(apps);
    storage.setItem(KEY, JSON.stringify({ version: 1, apps: next }));
    return next; // Callers replace in-memory state only after the write succeeds.
  }
  function move(apps, from, to) {
    var next = apps.slice();
    if (from < 0 || from >= next.length || to < 0 || to >= next.length) { return next; }
    next.splice(to, 0, next.splice(from, 1)[0]); return next;
  }
  function navigate(rows, row, col, key) {
    if (key === 'ArrowLeft') { col = Math.max(0, col - 1); }
    if (key === 'ArrowRight') { col = Math.min(rows[row] - 1, col + 1); }
    if (key === 'ArrowUp') { row = Math.max(0, row - 1); }
    if (key === 'ArrowDown') { row = Math.min(rows.length - 1, row + 1); }
    return [row, Math.min(col, rows[row] - 1)];
  }
  root.HubModel = { KEY: KEY, HOME: HOME, SELF: SELF, defaults: defaults, clean: clean, load: load, save: save, move: move, navigate: navigate };
  if (typeof module !== 'undefined') { module.exports = root.HubModel; }
}(typeof window !== 'undefined' ? window : globalThis));

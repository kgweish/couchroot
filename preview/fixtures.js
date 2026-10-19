/* Shared browser/test fixtures. This file is never packaged for the TV. */
(function (root) {
  'use strict';
  function catalog(kind) {
    var apps = [
      { id: 'kIciSQlYEM.plex', name: 'Plex', show: true },
      { id: '9Ur5IzDKqV.TizenYouTube', name: 'YouTube', show: true }
    ];
    if (kind === 'test') {
      for (var i = 0; i < 12; i++) apps.push({ id: 'Store00001.app' + i, name: 'App ' + String(i).padStart(2, '0'), show: true, iconPath: '' });
    } else {
      [
        ['org.tizen.netflix-app', 'Netflix'], ['org.tizen.primevideo', 'Prime Video'],
        ['MCmYXNxgcu.DisneyPlus', 'Disney+'], ['LBUAQX1exg.Hulu', 'Hulu'],
        ['rJeHak5zRg.Spotify', 'Spotify'], ['gzcc4LRFBF.Peacock', 'Peacock'],
        ['OGLLvqej7u.CrunchyrollWebApp', 'Crunchyroll'], ['XtU8fQk2gN.ESPN', 'ESPN'],
        ['3KA0pm7a7V.TubiTV', 'Tubi'], ['Store00001.local', 'Local Cinema']
      ].forEach(function (app) { apps.push({ id: app[0], name: app[1], show: true, iconPath: '' }); });
    }
    return apps;
  }
  // Self-contained so Playwright can pass this function to addInitScript.
  function install(options) {
    options = options || {};
    window.launches = [];
    window.discoveryFail = !!options.discoveryFail;
    window.launchFail = !!options.launchFail;
    window.testApps = options.apps;
    window.tizen = {
      application: {
        getAppsInfo: function (ok, fail) {
          setTimeout(function () { window.discoveryFail ? fail({ name: 'SecurityError' }) : ok(window.testApps); }, options.discoveryDelay || 20);
        },
        launch: function (id, ok, fail) {
          window.launches.push(id);
          window.dispatchEvent(new CustomEvent('hub-preview-launch', { detail: id }));
          function complete() {
            if (window.launchFail) { fail({ name: 'NotFoundError' }); return; }
            ok();
            if (options.launchHandoff) {
              Object.defineProperty(document, 'hidden', { configurable: true, value: true });
              document.dispatchEvent(new Event('visibilitychange'));
              setTimeout(function () {
                delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
              }, 500);
            }
          }
          if (options.launchDelay) { setTimeout(complete, options.launchDelay); } else { complete(); }
        }
      },
      tvaudiocontrol: { playSound: function () {} }
    };
    if (options.badStorage) localStorage.setItem('minimal-hub.shortcuts.v1', 'broken');
  }
  var api = { catalog: catalog, install: install };
  if (typeof module !== 'undefined') module.exports = api;
  else root.HubFixtures = api;
}(typeof window !== 'undefined' ? window : globalThis));

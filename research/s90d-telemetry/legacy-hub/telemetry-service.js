/* Both TVs: normal signed service launch after the dashboard is ready.
   Only public preferences cross this boundary; pairing remains app-private. */
(function (root) {
  'use strict';
  function bootMark(name) { if (root.HubBootTrace) { root.HubBootTrace.mark(name); } }
  bootMark('telemetry-service-entry');
  var latest, timer, retryTimer, loadTimer, last = '', failed = false, retries = 0;
  var retryDelays = [2000, 4000, 8000, 16000, 30000, 30000];
  function retry(callback) {
    if (retryTimer || retries >= retryDelays.length) { return; }
    retryTimer = root.setTimeout(function () { retryTimer = null; callback(); }, retryDelays[retries++]);
  }
  function unavailable() { failed = true; retry(dispatch); }
  function dispatch() {
    timer = null;
    if (!latest) { retry(load); return; }
    if (!root.tizen || !root.tizen.application || !root.tizen.ApplicationControl || root.document.hidden) { retry(dispatch); return; }
    var value = latest, key = JSON.stringify(value);
    if (key === last && !failed) { return; }
    last = key; failed = false;
    bootMark('telemetry-dispatch');
    try {
      var data = [new root.tizen.ApplicationControlData('telemetry.enabled', [String(value.enabled)]), new root.tizen.ApplicationControlData('telemetry.receiver_url', [value.endpoint])];
      var control = new root.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default', null, null, null, data);
      root.tizen.application.launchAppControl(control, 'MiniTelemetry.Start', function () { retries = 0; }, unavailable);
    } catch (_) { unavailable(); }
  }
  root.HubTelemetryService = { apply: function (value) {
    latest = {schema: 1, enabled: value.enabled, endpoint: value.endpoint};
    if (!timer) { timer = root.setTimeout(dispatch, 1500); }
  }};
  function load() {
    if (root.document.hidden) { return; }
    bootMark('telemetry-load');
    if (!root.HubTelemetry || !root.tizen) { retry(load); return; }
    try { root.HubTelemetry.create(root.tizen, root.localStorage).load(function () { bootMark('telemetry-loaded'); }, function () { retry(load); }); }
    catch (_) { retry(load); }
    bootMark('telemetry-load-returned');
  }
  function scheduleLoad() {
    if (latest || loadTimer || root.document.hidden || (root.document.hasFocus && !root.document.hasFocus())) { return; }
    // Resolving the Tizen filesystem can block even with callback-based APIs.
    // Wait for the foreground handoff before optional monitoring does I/O.
    loadTimer = root.setTimeout(function () {
      loadTimer = null;
      if (!latest && (!root.document.hasFocus || root.document.hasFocus())) { load(); }
    }, 1500);
  }
  root.addEventListener('focus', scheduleLoad);
  if (root.document.readyState === 'loading') { root.document.addEventListener('DOMContentLoaded', scheduleLoad); } else { scheduleLoad(); }
  root.document.addEventListener('visibilitychange', function () {
    if (!root.document.hidden) {
      retries = 0; last = '';
      if (latest) { root.HubTelemetryService.apply(latest); } else { scheduleLoad(); }
    }
  });
}(window));

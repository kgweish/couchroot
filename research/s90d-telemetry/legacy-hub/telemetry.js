/* Public filesystem API: preferences only; credentials stay outside the app. */
(function (root) {
  'use strict';
  var name = 'telemetry.json', defaults = { schema: 1, enabled: false, endpoint: 'https://receiver.example.invalid/v1/devices/' + (root.HUB_DEVICE_ID || 's90d') };
  function validate(value) {
    if (!value || value.schema !== 1 || typeof value.enabled !== 'boolean' || typeof value.endpoint !== 'string' || value.endpoint.length > 512) { throw new Error('Invalid telemetry preferences.'); }
    var url;
    try { url = new URL(value.endpoint); } catch (_) { throw new Error('Enter a valid HTTPS receiver URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !(url.pathname === '/v1/devices/' + (root.HUB_DEVICE_ID || 's90d') || ((root.HUB_DEVICE_ID || 's90d') === 's90d' && url.pathname === '/v1/s90d'))) { throw new Error('Use the HTTPS receiver URL for this TV’s configured device ID.'); }
    return { schema: 1, enabled: value.enabled, endpoint: url.href };
  }
  function create(platform, storage) {
    function applied(ok, value) { if (root.HubTelemetryService) { root.HubTelemetryService.apply(value); } ok(value); }
    function directory(ok, fail) {
      try { platform.filesystem.resolve('wgt-private', ok, fail, 'rw'); } catch (error) { fail(error); }
    }
    return {
      load: function (ok, fail) {
        if (!platform) {
          try { var saved = storage.getItem('minimal-hub.telemetry.v1'); applied(ok, saved ? validate(JSON.parse(saved)) : validate(defaults)); } catch (error) { fail(error); }
          return;
        }
        directory(function (dir) {
          var file;
          try { file = dir.resolve(name); } catch (error) { if (error.name === 'NotFoundError') { applied(ok, validate(defaults)); } else { fail(error); } return; }
          file.readAsText(function (text) { try { applied(ok, validate(JSON.parse(text))); } catch (error) { fail(error); } }, fail, 'UTF-8');
        }, fail);
      },
      save: function (value, ok, fail) {
        try { value = validate(value); } catch (error) { fail(error); return; }
        if (!platform) { try { storage.setItem('minimal-hub.telemetry.v1', JSON.stringify(value)); applied(ok, value); } catch (error) { fail(error); } return; }
        directory(function (dir) {
          var temp;
          try { try { temp = dir.resolve(name + '.new'); } catch (error) { if (error.name !== 'NotFoundError') { throw error; } temp = dir.createFile(name + '.new'); } }
          catch (error) { fail(error); return; }
          temp.openStream('w', function (stream) {
            try { stream.write(JSON.stringify(value)); stream.close(); }
            catch (error) { try { stream.close(); } catch (_) {} fail(error); return; }
            dir.moveTo(temp.fullPath, dir.fullPath + '/' + name, true, function () { applied(ok, value); }, fail);
          }, fail, 'UTF-8');
        }, fail);
      }
    };
  }
  root.HubTelemetry = { create: create, validate: validate };
  if (typeof module !== 'undefined') { module.exports = root.HubTelemetry; }
}(typeof window !== 'undefined' ? window : globalThis));

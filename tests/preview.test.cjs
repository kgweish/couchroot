const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { start } = require('../preview/server.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
let server, url, browser;
const landscapePixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function conceptPage(options) {
  const page = await browser.newPage(options);
  await page.route('https://images.unsplash.com/**', route => route.fulfill({ contentType: 'image/png', body: landscapePixel }));
  return page;
}
before(async () => {
  ({ server, url } = await start(0));
  browser = await chromium.launch({ headless: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });

test('preview serves only UI assets and injects mocks only on its hub route', async () => {
  for (const route of ['/README.md', '/scripts/sign.py', '/preview/server.cjs', '/web/missing.png', '/web/%2e%2e%2fscripts%2fsign.py']) {
    assert.equal((await fetch(url + route)).status, 404, route);
  }
  assert.match(await (await fetch(url + '/hub')).text(), /preview\/runtime.js/);
  assert.match(await (await fetch(url + '/hub')).text(), /connect-src 'self'/);
  assert.doesNotMatch(await (await fetch(url + '/web/index.html')).text(), /preview\/runtime.js/);
  assert.match(await (await fetch(url + '/web/index.html')).text(), /connect-src 'none'/);
  assert.match(await (await fetch(url + '/hub?scenario=tvos-concept')).text(), /img-src 'self' data: file: https:\/\/images\.unsplash\.com;/);
  for (const route of ['/hub?scenario=compact', '/web/index.html']) {
    assert.doesNotMatch(await (await fetch(url + route)).text(), /images\.unsplash\.com/);
  }
  assert.match((await fetch(url + '/web/icon.png')).headers.get('content-type'), /image\/png/);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
});

test('saving a preview asset reloads the app through its preview-only content policy', async () => {
  const page = await browser.newPage();
  const probe = path.resolve(__dirname, `../preview/.reload-check-${process.pid}`);
  try {
    await page.goto(url + '/hub?scenario=home');
    for (let i = 0; i < 2; i++) {
      const response = await page.waitForResponse(r => r.url().endsWith('/__preview/version'));
      assert.equal(response.status(), 200);
      await response.finished();
    }
    const reloaded = page.waitForEvent('domcontentloaded');
    await fs.writeFile(probe, 'temporary reload check');
    await reloaded;
    await page.locator('#favorites button').first().waitFor();
  } finally {
    await fs.rm(probe, { force: true });
    await page.close();
  }
});

test('workbench runs the shipped UI, records simulated launches, switches and resets scenarios', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(url + '/')) external.push(request.url()); });
  await page.goto(url);
  const hub = page.frameLocator('#hub');
  await hub.locator('#favorites button').first().click();
  await page.waitForFunction(() => document.getElementById('activity').textContent.includes('kIciSQlYEM.plex'));
  await page.selectOption('#scenario', 'many');
  await hub.locator('#favorites button').nth(11).waitFor();
  assert.equal(await hub.locator('#favorites button').count(), 12);
  await page.selectOption('#scenario', 'empty');
  await hub.locator('#empty-home').waitFor();
  await hub.locator('#edit-apps').click();
  await hub.locator('#editor-actions button').first().click();
  await hub.locator('#editor-list button').first().click();
  await hub.locator('#editor-status').filter({ hasText: 'added' }).waitFor();
  await page.locator('#reset').click();
  await hub.locator('#empty-home').waitFor();
  assert.equal(await hub.locator('#favorites button').count(), 0);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await page.close();
});

test('concept Settings exposes launcher controls without a monitoring integration', async () => {
  const page = await conceptPage();
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.locator('#settings').click();
  assert.equal(await page.getByRole('button', { name: /TV monitoring/ }).count(), 0);
  await page.locator('#setting-clock').click();
  assert.equal(await page.locator('#clock-value').textContent(), '24-hour');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#design-date').isVisible(), true);
  assert.equal(await page.evaluate(() => typeof window.HubTelemetry), 'undefined');
  await page.close();
});

test('error scenarios and missing artwork reach the actual app fallbacks', async () => {
  const page = await browser.newPage();
  for (const [scenario, selector, text] of [
    ['launch-error', '#launch-error-title', 'Could not open'],
    ['discovery-error', '#editor-status', 'Could not list'],
    ['bad-storage', '#status', 'Saved apps could not be read']
  ]) {
    await page.goto(`${url}/hub?scenario=${scenario}&reset=1&static=1`);
    await page.locator(selector).filter({ hasText: text }).waitFor();
  }
  await page.goto(url + '/hub?scenario=missing-artwork&reset=1&static=1');
  await page.waitForFunction(() => window.testApps && document.querySelector('#favorites button')?.textContent.includes('Local Cinema'));
  await page.waitForFunction(() => !document.querySelector('#favorites img'));
  assert.match(await page.locator('#favorites').textContent(), /Local Cinema/);
  await page.close();
});

test('startup preference preview keeps the scroll cue when the last setting is clipped', async () => {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 960, height: 540 }]) {
    const page = await browser.newPage({ viewport });
    await page.goto(url + '/hub?scenario=startup-selection&reset=1&static=1');
    await page.locator('#setting-start:focus').waitFor();
    const state = await page.evaluate(() => {
      const list = document.getElementById('settings-options'), cue = document.getElementById('settings-scroll');
      return { clipped: list.lastElementChild.getBoundingClientRect().bottom > list.getBoundingClientRect().bottom + 1,
        cue: !cue.hidden && cue.classList.contains('can-scroll-down') };
    });
    assert.equal(state.cue, state.clipped, JSON.stringify({ viewport, state }));
    await page.close();
  }
});

test('tvOS design navigation follows the visible rows and stays scoped to its scenario', async () => {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 960, height: 540 }]) {
    const page = await conceptPage({ viewport });
    await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
    await page.locator('body.design-tvos').waitFor({ timeout: 2000 });
    assert.equal(await page.locator('#favorites > button').count(), 15);
    assert.equal(await page.locator('#home-clock').isVisible(), true);
    await page.locator('#favorites > button').first().focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-id'), 'LBUAQX1exg.Hulu');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-id'), '3KA0pm7a7V.TubiTV');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator(':focus').getAttribute('data-id'), 'DemoInput1.tv');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator(':focus').getAttribute('data-id'), 'DemoInput1.hdmi1');
    const visible = await page.locator(':focus').evaluate(el => {
      const tile = el.getBoundingClientRect(), label = el.querySelector('.design-caption').getBoundingClientRect();
      return tile.top >= 0 && label.bottom <= innerHeight;
    });
    assert.equal(visible, true);
    await page.goto(url + '/hub?scenario=compact&reset=1&static=1');
    await page.locator('#favorites > button').nth(11).waitFor();
    assert.equal(await page.locator('body.design-tvos').count(), 0);
    assert.equal(await page.locator('#favorites > button').count(), 12);
    await page.locator('#favorites > button').first().focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-id'), 'MCmYXNxgcu.DisneyPlus');
    await page.close();
  }
});

test('Gallery date stays above apps with the clock off and earlier layouts keep Move geometry', async () => {
  const page = await conceptPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.locator('.design-caption').nth(14).waitFor();
  await page.locator('#settings').click();
  await page.locator('#setting-clock').click();
  await page.locator('#setting-clock').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#home-clock').isVisible(), false);
  const header = await page.locator('#design-date').boundingBox();
  assert.ok((await page.locator('#favorites > button').first().boundingBox()).y > header.y + header.height, 'Date stays above apps with the clock off');
  await page.locator('#settings').click();
  await page.locator('#setting-layout').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#design-date').isVisible(), false);
  await page.locator('#favorites > button').first().focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator(':focus').getAttribute('data-id'), 'org.tizen.primevideo');
  await page.locator('#settings').click();
  await page.locator('#setting-layout').click();
  await page.keyboard.press('Escape');
  await page.locator('#edit-apps').click();
  await page.locator('#editor-list button').first().click();
  await page.locator('#editor-list button').first().click();
  const tile = page.locator('#favorites > button[data-id="kIciSQlYEM.plex"]');
  const before = await tile.boundingBox();
  await page.keyboard.press('ArrowDown');
  assert.ok((await tile.boundingBox()).y > before.y);
  assert.equal(await page.locator('#design-title').isVisible(), false);
  await page.close();
});

test('design footer arrows reach Undo remove after editing', async () => {
  const page = await conceptPage();
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.locator('.design-caption').nth(14).waitFor();
  await page.locator('#edit-apps').click();
  await page.locator('#editor-list button').first().click();
  await page.locator('#editor-list button').nth(1).click();
  await page.keyboard.press('Escape');
  await page.locator('#settings').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator(':focus').getAttribute('id'), 'undo-remove');
  await page.close();
});

test('concept service logos load locally and stay centered in their cards', async () => {
  const page = await conceptPage({ viewport: { width: 1920, height: 1080 } });
  const external = [];
  page.on('request', request => {
    if (!request.url().startsWith(url + '/') && !request.url().startsWith('https://images.unsplash.com/')) external.push(request.url());
  });
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.waitForFunction(() => {
    const logos = [...document.querySelectorAll('.design-brand-logo')];
    return logos.length === 11 && logos.every(image => image.complete && image.naturalWidth > 0);
  }, null, { timeout: 2000 });
  assert.equal(await page.locator('.design-brand-logo').evaluateAll(images => images.every(image => {
    const logo = image.getBoundingClientRect(), card = image.parentElement.getBoundingClientRect();
    return Math.abs(logo.left + logo.width / 2 - card.left - card.width / 2) < 2 &&
      Math.abs(logo.top + logo.height / 2 - card.top - card.height / 2) < 2;
  })), true);
  assert.deepEqual(external, []);
  await page.close();
});

test('a missing concept logo keeps the app name and fallback wordmark available', async () => {
  for (const [file, name] of [['netflix.png', 'Netflix'], ['peacock.png', 'Peacock']]) {
    const page = await conceptPage();
    await page.route('**/web/logos/' + file, route => route.abort());
    await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
    await page.locator('.design-brand-logo').first().waitFor({ timeout: 2000 });
    const tile = page.getByRole('button', { name: 'Open ' + name, exact: true });
    await tile.locator('.design-brand-logo').waitFor({ state: 'detached' });
    assert.equal(await tile.locator('.brand-wordmark').isVisible(), true);
    assert.equal(await tile.locator('.design-caption').textContent(), name);
    if (name === 'Peacock') {
      const contrast = await tile.evaluate(card => {
        function luminance(color) {
          const rgb = color.match(/[\d.]+/g).slice(0, 3).map(value => {
            const c = Number(value) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        }
        const text = luminance(getComputedStyle(card.querySelector('.brand-wordmark')).color);
        const background = luminance(getComputedStyle(card).backgroundColor);
        return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
      });
      assert.ok(contrast >= 4.5, 'Peacock fallback contrast: ' + contrast);
    }
    await page.close();
  }
});

test('25 streaming services have local picker artwork and can be added without filling Home by default', async () => {
  const services = ['YouTube', 'Netflix', 'Prime Video', 'Disney+', 'Hulu', 'HBO Max', 'Paramount+',
    'Peacock', 'Apple TV', 'Tubi', 'The Roku Channel', 'Pluto TV', 'Samsung TV Plus', 'Plex',
    'YouTube TV', 'Sling TV', 'Fubo', 'DIRECTV', 'ViX', 'ESPN', 'Crunchyroll', 'discovery+', 'STARZ', 'AMC+', 'PBS'];
  const page = await conceptPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(2000);
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  assert.equal(await page.locator('#favorites > button').count(), 15);
  await page.locator('#edit-apps').click();
  await page.locator('#editor-actions button').first().click();
  await page.locator('#editor-list .app-row').nth(29).waitFor();
  const names = await page.locator('#editor-list .row-name').allTextContents();
  for (const name of services) assert.ok(names.includes(name), name + ' is available to add');
  await page.waitForFunction(() => {
    const logos = [...document.querySelectorAll('#editor-list .design-row-logo')];
    return logos.length === 26 && logos.every(image => image.complete && image.naturalWidth > 0);
  });
  const hbo = page.locator('#editor-list .app-row').filter({ has: page.locator('.row-name', { hasText: /^HBO Max$/ }) });
  await hbo.focus();
  await page.waitForFunction(() => document.querySelector('#preview-art .design-brand-logo')?.src.endsWith('/hbomax.jpg'));
  await hbo.press('Enter');
  await page.locator('#editor-status').filter({ hasText: 'HBO Max added to Home' }).waitFor();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open HBO Max', exact: true }).locator('.design-brand-logo').waitFor();
  assert.equal(await page.locator('#favorites > button').count(), 16);
  await page.reload();
  await page.getByRole('button', { name: 'Open HBO Max', exact: true }).locator('.design-brand-logo').waitFor();
  await page.evaluate(() => { window.testApps.find(app => app.name === 'HBO Max').name = 'Max'; });
  await page.locator('#edit-apps').click();
  await page.locator('#editor-actions button').first().click();
  await page.locator('#editor-list .app-row').filter({ has: page.locator('.row-name', { hasText: /^Max$/ }) }).focus();
  await page.waitForFunction(() => document.querySelector('#preview-art .design-brand-logo')?.src.endsWith('/hbomax.jpg'));
  await page.goto(url + '/hub?scenario=compact&reset=1&static=1');
  assert.equal(await page.locator('#favorites > button').count(), 12);
  await page.close();
});

test('missing optional artwork keeps readable fallback text on a bright-brand service', async () => {
  const page = await conceptPage();
  await page.route('**/web/logos/pluto.jpg', route => route.abort());
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.locator('#edit-apps').click();
  await page.locator('#editor-actions button').first().click();
  await page.locator('#editor-list .app-row').filter({ has: page.locator('.row-name', { hasText: /^Pluto TV$/ }) }).click();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  const tile = page.getByRole('button', { name: 'Open Pluto TV', exact: true });
  await tile.locator('.design-brand-logo').waitFor({ state: 'detached' });
  assert.equal(await tile.locator('.brand-wordmark').isVisible(), true);
  const contrast = await tile.evaluate(card => {
    function luminance(color) {
      const rgb = color.match(/[\d.]+/g).slice(0, 3).map(value => {
        const c = Number(value) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    }
    const text = luminance(getComputedStyle(card.querySelector('.brand-wordmark')).color);
    const style = getComputedStyle(card), colors = style.backgroundImage.match(/rgba?\([^)]+\)/g) || [style.backgroundColor];
    return Math.min(...colors.map(color => {
      const background = luminance(color);
      return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
    }));
  });
  assert.ok(contrast >= 4.5, 'Optional service fallback contrast: ' + contrast);
  await page.close();
});

test('concept greeting and date follow local noon and midnight without reloading', async () => {
  const page = await conceptPage({ locale: 'en-US', timezoneId: 'America/Los_Angeles' });
  await page.clock.install({ time: new Date('2026-10-18T18:59:30Z') });
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  assert.equal(await page.locator('#design-title').textContent(), 'Good morning');
  assert.equal(await page.locator('#design-date').textContent(), 'Sunday, October 18');
  assert.equal(await page.locator('#design-date').getAttribute('datetime'), '2026-10-18');
  await page.clock.fastForward(30_100);
  assert.equal(await page.locator('#design-title').textContent(), 'Good afternoon');
  await page.clock.fastForward(5 * 60 * 60 * 1000);
  assert.equal(await page.locator('#design-title').textContent(), 'Good evening');
  await page.clock.fastForward(7 * 60 * 60 * 1000);
  assert.equal(await page.locator('#design-title').textContent(), 'Good evening');
  assert.equal(await page.locator('#design-date').textContent(), 'Monday, October 19');
  assert.equal(await page.locator('#design-date').getAttribute('datetime'), '2026-10-19');
  await page.close();
});

test('S89C layout choices render Gallery, Comfortable and Compact with matching arrows', async () => {
  const page = await conceptPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.locator('#settings').click();
  assert.equal(await page.locator('#layout-value').textContent(), 'Gallery');
  for (const [name, columns, cells] of [['Gallery', 5, 10], ['Comfortable', 3, 6], ['Compact', 4, 8]]) {
    await page.locator('#setting-layout').focus();
    assert.equal(await page.locator('#layout-value').textContent(), name);
    assert.equal(await page.locator('#setting-visual > span').count(), cells);
    await page.keyboard.press('Escape');
    const tiles = page.locator('#favorites > button');
    const ids = await tiles.evaluateAll(items => items.map(item => item.dataset.id));
    assert.equal(await page.locator('#favorites').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length), columns);
    assert.equal(await page.locator('.design-caption').count(), name === 'Gallery' ? ids.length : 0);
    await tiles.first().focus(); await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-id'), ids[columns]);
    await page.locator('#settings').click(); await page.locator('#setting-layout').click();
  }
  assert.equal(await page.locator('#layout-value').textContent(), 'Gallery');
  await page.reload(); await page.locator('#settings').click();
  assert.equal(await page.locator('#layout-value').textContent(), 'Gallery');
  assert.equal(await page.evaluate(() => localStorage.getItem('minimal-hub.design.v1')), 'gallery');
  await page.close();
});

test('S89C layout choices persist, handle failed saves and retain legacy layout preferences', async () => {
  const page = await conceptPage();
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.locator('#settings').click(); await page.locator('#setting-layout').click();
  await page.reload(); await page.locator('#settings').click();
  assert.equal(await page.locator('#layout-value').textContent(), 'Comfortable');
  await page.locator('#setting-layout').click();
  await page.reload(); await page.locator('#settings').click();
  assert.equal(await page.locator('#layout-value').textContent(), 'Compact');
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('QuotaExceeded'); }; });
  await page.locator('#setting-layout').click();
  assert.match(await page.locator('#settings-status').textContent(), /Could not save/);
  assert.equal(await page.locator('#layout-value').textContent(), 'Compact');
  await page.reload();
  await page.evaluate(() => {
    localStorage.removeItem('minimal-hub.design.v1');
    localStorage.setItem('minimal-hub.layout.v1', 'comfortable');
  });
  await page.reload(); await page.locator('#settings').click();
  assert.equal(await page.locator('#layout-value').textContent(), 'Comfortable');
  await page.evaluate(() => {
    localStorage.setItem('minimal-hub.layout.v1', 'compact');
    localStorage.setItem('minimal-hub.design.v1', 'invalid');
  });
  await page.reload(); await page.locator('#settings').click();
  assert.equal(await page.locator('#layout-value').textContent(), 'Gallery');
  await page.goto(url + '/hub?scenario=compact&reset=1&static=1');
  await page.locator('#settings').click();
  assert.equal(await page.locator('#layout-value').textContent(), 'Compact');
  assert.equal(await page.locator('#setting-photos').isVisible(), false);
  await page.close();
});

test('S89C move mode follows the selected layout and preserves the focused tile', async () => {
  for (const [layout, columns] of [['gallery', 5], ['comfortable', 3], ['compact', 4]]) {
    const page = await conceptPage();
    await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
    await page.evaluate(layout => localStorage.setItem('minimal-hub.design.v1', layout), layout);
    await page.reload();
    await page.locator('#edit-apps').click();
    await page.locator('#editor-list button').first().click();
    await page.locator('#editor-list button').first().click();
    await page.locator(':focus').evaluate(tile => { window.movingTile = tile; });
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#move-position').textContent(), `Position ${columns + 1} of 15`);
    assert.equal(await page.locator(':focus').evaluate(tile => tile === window.movingTile), true);
    await page.keyboard.press('Enter');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('minimal-hub.shortcuts.v1')).apps);
    assert.equal(saved[columns].id, 'kIciSQlYEM.plex');
    await page.close();
  }
});

test('photo setting stops downloads and persists across reloads', async () => {
  const page = await conceptPage();
  let requests = 0;
  await page.route('https://images.unsplash.com/**', route => {
    requests++;
    return route.fulfill({ contentType: 'image/png', body: landscapePixel });
  });
  await page.clock.install();
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.locator('.design-landscape.is-active').waitFor();
  await page.locator('#settings').click();
  const setting = page.locator('#setting-photos');
  await setting.focus({ timeout: 2000 });
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#photos-value').textContent(), 'Off');
  assert.equal(await setting.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator(':focus').getAttribute('id'), 'setting-photos');
  assert.equal(await page.locator('.design-landscape.is-active').count(), 0);
  assert.equal(await page.locator('#design-photo-credit').textContent(), '');
  assert.equal(await page.evaluate(() => localStorage.getItem('minimal-hub.photos.v1')), 'off');
  const count = requests;
  await page.clock.fastForward(180_000);
  assert.equal(requests, count);
  await page.reload();
  await page.locator('#settings').click();
  assert.equal(await page.locator('#photos-value').textContent(), 'Off');
  assert.equal(requests, count);
  await setting.focus(); await page.keyboard.press('Enter');
  await page.locator('.design-landscape.is-active').waitFor();
  assert.equal(await page.locator('#photos-value').textContent(), 'On');
  assert.equal(requests, count + 1);
  await page.close();
});

test('photo setting handles failed saves and cancels a photo still loading', async () => {
  const page = await conceptPage();
  let pending;
  await page.route('https://images.unsplash.com/**', route => { pending = route; });
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1', { waitUntil: 'domcontentloaded' });
  await page.locator('#settings').click();
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'minimal-hub.photos.v1') throw new Error('QuotaExceeded');
      return write.call(this, key, value);
    };
    window.restorePhotoStorage = () => { Storage.prototype.setItem = write; };
  });
  await page.locator('#setting-photos').click({ timeout: 2000 });
  assert.match(await page.locator('#settings-status').textContent(), /Could not save/);
  assert.equal(await page.locator('#photos-value').textContent(), 'On');
  await page.evaluate(() => window.restorePhotoStorage());
  await page.locator('#setting-photos').click();
  await pending.fulfill({ contentType: 'image/png', body: landscapePixel });
  assert.equal(await page.locator('.design-landscape.is-active').count(), 0);
  assert.equal(await page.locator('#design-photo-credit').textContent(), '');
  assert.equal(await page.locator('#photos-value').textContent(), 'Off');
  await page.close();
});

test('landscapes rotate with two frames, preserve focus and retain the last image on failure', async () => {
  const page = await conceptPage({ reducedMotion: 'reduce' });
  let fail = false;
  const requests = [];
  await page.route('https://images.unsplash.com/**', route => {
    requests.push(route.request().url());
    return fail ? route.abort() : route.fulfill({ contentType: 'image/png', body: landscapePixel });
  });
  await page.clock.install();
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  const active = page.locator('.design-landscape.is-active');
  await active.waitFor();
  const first = await active.getAttribute('src');
  const credit = await page.locator('#design-photo-credit').textContent();
  assert.equal(await page.locator('.design-landscape').count(), 2);
  assert.equal(await active.evaluate(image => getComputedStyle(image).transitionDuration), '0s');
  await page.locator('#favorites > button').first().focus();
  fail = true;
  await page.clock.fastForward(60_100);
  await page.waitForFunction(() => document.querySelector('.design-landscape:not(.is-active)').complete);
  assert.equal(requests.length, 2);
  assert.equal(await active.getAttribute('src'), first);
  assert.equal(await page.locator('#design-photo-credit').textContent(), credit);
  fail = false;
  await page.clock.fastForward(60_100);
  await page.waitForFunction(first => document.querySelector('.design-landscape.is-active').src !== first, first);
  assert.equal(await page.locator(':focus').getAttribute('data-id'), 'kIciSQlYEM.plex');
  assert.equal(await page.locator('.design-landscape').count(), 2);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const count = requests.length;
  await page.clock.fastForward(120_000);
  assert.equal(requests.length, count);
  const resumed = page.waitForRequest('https://images.unsplash.com/**');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await resumed;
  await page.close();
});

test('landscapes show fifteen different photos before repeating', async () => {
  const page = await conceptPage();
  await page.clock.install();
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  const active = page.locator('.design-landscape.is-active');
  await active.waitFor();
  const first = await active.getAttribute('src');
  const seen = new Set([first]);
  for (let i = 1; i < 15; i++) {
    const previous = await active.getAttribute('src');
    await page.clock.fastForward(60_100);
    await page.waitForFunction(previous => document.querySelector('.design-landscape.is-active').src !== previous, previous);
    const current = await active.getAttribute('src');
    assert.ok(!seen.has(current), `Photo repeated after ${i} minutes`);
    seen.add(current);
  }
  await page.clock.fastForward(60_100);
  await page.waitForFunction(first => document.querySelector('.design-landscape.is-active').src === first, first);
  assert.equal(await page.locator('.design-landscape').count(), 2);
  await page.close();
});

test('offline landscapes leave the gradient, greeting and app navigation usable', async () => {
  const page = await conceptPage();
  await page.route('https://images.unsplash.com/**', route => route.abort());
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.waitForFunction(() => document.querySelector('.design-landscape')?.complete);
  assert.equal(await page.locator('.design-landscape.is-active').count(), 0);
  assert.equal(await page.locator('#design-photo-credit').textContent(), '');
  assert.match(await page.locator('.ambient').evaluate(el => getComputedStyle(el).backgroundImage), /radial-gradient/);
  assert.match(await page.locator('#design-title').textContent(), /^Good (morning|afternoon|evening)$/);
  await page.locator('#favorites > button').first().focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator(':focus').getAttribute('data-id'), 'LBUAQX1exg.Hulu');
  await page.close();
});

test('S89C Peacock TV name uses the bundled logo on Home and in the editor', async () => {
  const page = await conceptPage({ viewport: { width: 1920, height: 1080 } });
  await page.route('**/preview/fixtures.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: require('node:fs').readFileSync(path.resolve(__dirname, '../preview/fixtures.js'), 'utf8')
      .replace("['gzcc4LRFBF.Peacock', 'Peacock']", "['gzcc4LRFBF.Peacock', 'Peacock TV']")
  }));
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  const tile = page.getByRole('button', { name: 'Open Peacock TV', exact: true });
  await tile.waitFor();
  assert.equal(await tile.locator('.design-brand-logo').count(), 1);
  await page.waitForFunction(() => {
    const logo = document.querySelector('[data-id="gzcc4LRFBF.Peacock"] .design-brand-logo');
    return logo && logo.complete && logo.naturalWidth > 0;
  }, null, { timeout: 2000 });
  assert.equal(await tile.locator('.brand-wordmark').evaluate(el => getComputedStyle(el).visibility), 'hidden');
  await page.locator('#edit-apps').click();
  const row = page.locator('#editor-list .app-row').filter({ has: page.locator('.row-name', { hasText: /^Peacock TV$/ }) });
  await row.focus();
  assert.equal(await row.locator('.design-row-logo').count(), 1);
  await page.locator('#preview-art .design-brand-logo').waitFor();
  assert.match(await page.locator('#preview-art .design-brand-logo').getAttribute('src'), /peacock\.png$/);
  await page.close();
});

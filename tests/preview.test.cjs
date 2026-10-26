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
async function galleryScroll(page, key, selector = '.app-stage') {
  return page.evaluate(({key,selector}) => new Promise((resolve, reject) => {
    const stage = document.querySelector(selector), before = stage.scrollTop;
    if (key) document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const immediate = stage.scrollTop, positions = [before, immediate], start = performance.now();
    let previous = immediate, still = 0;
    function frame() {
      const position = stage.scrollTop;
      positions.push(position);
      still = Math.abs(position - previous) < .1 ? still + 1 : 0; previous = position;
      if (still >= 4 && performance.now() - start > 100) return resolve({ before, immediate, final: position, positions });
      if (performance.now() - start > 1800) return reject(new Error('Gallery scrolling did not settle'));
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }), {key,selector});
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

test('Gallery workbench reload initializes its observers without runtime errors', async () => {
  const page = await conceptPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack));
  await page.goto(url + '/?scenario=tvos-concept');
  const hub = page.frameLocator('#hub');
  await hub.locator('.design-caption').nth(14).waitFor();
  await page.reload();
  await hub.locator('.design-caption').nth(14).waitFor();
  await hub.locator('#edit-apps').click();
  await hub.locator('#editor-actions button').first().click();
  assert.equal(await hub.locator('.design-row-logo').count() > 0, true);
  assert.deepEqual(errors, []);
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
    assert.equal(await page.locator(':focus').getAttribute('data-id'), 'HubInput.TV.0');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator(':focus').getAttribute('data-id'), 'HubInput.HDMI.1');
    await galleryScroll(page, null);
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

test('Gallery arrows reach Samsung Home above the dock and the footer after every app row', async () => {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 960, height: 540 }]) {
    const page = await conceptPage({ viewport, reducedMotion: 'reduce' });
    await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
    await page.locator('.design-caption').nth(14).waitFor();
    const first = page.locator('#favorites > button').first();
    await first.focus();
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator(':focus').getAttribute('data-app'), 'home');
    const geometry = await page.evaluate(() => ({
      homeBottom: document.querySelector('[data-app="home"]').getBoundingClientRect().bottom,
      dockTop: document.querySelector('#favorites > button').getBoundingClientRect().top
    }));
    assert.ok(geometry.homeBottom < geometry.dockTop, 'Samsung Home sits above the first app row');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-id'), 'kIciSQlYEM.plex');
    for (let row = 0; row < 3; row++) await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'edit-apps');
    const footer = await page.locator('#edit-apps').boundingBox();
    const lastLabel = await page.locator('.design-caption').last().boundingBox();
    assert.ok(footer.y > lastLabel.y + lastLabel.height, 'Edit apps follows the last app caption');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'settings');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'settings');
    const visible = await page.locator(':focus').evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    });
    assert.equal(visible, true, 'Returning from Settings reveals the footer control');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator(':focus').getAttribute('data-app'), 'home');
    assert.ok(Math.abs(await first.evaluate(el => el.getBoundingClientRect().top) - geometry.dockTop) < 1, 'Returning to Samsung Home restores the scenic dock view');
    await page.keyboard.press('ArrowDown');
    for (let row = 0; row < 3; row++) await page.keyboard.press('ArrowDown');
    for (let row = 0; row < 3; row++) await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator(':focus').getAttribute('data-id'), 'kIciSQlYEM.plex');
    assert.ok(Math.abs(await first.evaluate(el => el.getBoundingClientRect().top) - geometry.dockTop) < 1, 'Up to the dock restores its original position');
    await page.close();
  }
});

test('Gallery rows animate in both directions and return smoothly to the scenic dock', async () => {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 960, height: 540 }]) {
    const page = await conceptPage({ viewport, reducedMotion: 'no-preference' });
    await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
    await page.locator('.design-caption').nth(14).waitFor();
    await page.waitForTimeout(100); // Fixtures finish initial discovery and its grid rebuild after 20 ms.
    const second = await galleryScroll(page, 'ArrowDown');
    assert.equal(second.immediate, second.before, 'A row change must start without a jump');
    assert.ok(new Set(second.positions.map(Math.round)).size > 4, 'The row must pass through intermediate positions');
    assert.ok(second.final > 0);
    const third = await galleryScroll(page, 'ArrowDown');
    assert.ok(third.final > second.final);
    const back = await galleryScroll(page, 'ArrowUp');
    assert.equal(back.immediate, back.before, 'Up must animate from the current position');
    assert.ok(Math.abs(back.final - second.final) < 3, 'The second row must return to the same vertical position');
    const dock = await galleryScroll(page, 'ArrowUp');
    assert.equal(dock.immediate, dock.before, 'Returning to the dock must not reset scrollTop immediately');
    assert.ok(new Set(dock.positions.map(Math.round)).size > 4);
    assert.equal(dock.final, 0);
    assert.equal(await page.locator(':focus').getAttribute('data-id'), 'kIciSQlYEM.plex');
    await page.close();
  }
});

test('rapid Gallery arrows retarget scrolling without jumping or replaying old rows', async () => {
  const page = await conceptPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'no-preference' });
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.locator('.design-caption').nth(14).waitFor();
  await page.waitForTimeout(100);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('.app-stage').scrollTop > 5);
  const horizontal = await page.evaluate(() => {
    const stage = document.querySelector('.app-stage'), before = stage.scrollTop;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    return { before, after: stage.scrollTop };
  });
  assert.equal(horizontal.after, horizontal.before, 'Changing columns must not finish an in-flight scroll instantly');
  await page.evaluate(() => {
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'ArrowUp']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: true, bubbles: true, cancelable: true }));
    }
  });
  const result = await galleryScroll(page, null);
  assert.equal(await page.locator(':focus').getAttribute('data-id'), '9Ur5IzDKqV.TizenYouTube');
  assert.equal(result.final, 0);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.app-stage').evaluate(stage => stage.scrollTop), 0, 'Interrupted destinations must stay cancelled');
  await page.close();
});

test('Gallery keeps instant navigation for reduced motion and a missing scrollTo API', async () => {
  for (const legacy of [false, true]) {
    const page = await conceptPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: legacy ? 'no-preference' : 'reduce' });
    await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
    await page.locator('.design-caption').nth(14).waitFor();
    await page.waitForTimeout(100);
    if (legacy) await page.evaluate(() => { document.querySelector('.app-stage').scrollTo = undefined; });
    const second = await galleryScroll(page, 'ArrowDown');
    assert.ok(second.immediate > 0);
    assert.equal(second.immediate, second.final);
    const dock = await galleryScroll(page, 'ArrowUp');
    assert.equal(dock.immediate, 0);
    assert.equal(dock.final, 0);
    await page.close();
  }
});

test('Gallery keeps Add apps and its utilities reachable when the saved Home is empty', async () => {
  const page = await conceptPage({ reducedMotion: 'reduce' });
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.evaluate(() => localStorage.setItem('minimal-hub.shortcuts.v1', JSON.stringify({ version: 1, apps: [] })));
  await page.reload();
  await page.locator('#empty-add').waitFor();
  assert.equal(await page.locator(':focus').getAttribute('id'), 'empty-add');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator(':focus').getAttribute('data-app'), 'home');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator(':focus').getAttribute('id'), 'empty-add');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator(':focus').getAttribute('id'), 'edit-apps');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator(':focus').getAttribute('id'), 'edit-apps');
  assert.equal(await page.locator('#favorites > button').count(), 0);
  await page.close();
});

test('Gallery reveals the dock caption in a short full-viewport window', async () => {
  const page = await conceptPage({ viewport: { width: 1280, height: 600 }, reducedMotion: 'reduce' });
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.locator('.design-caption').nth(14).waitFor();
  await page.locator('#favorites > button').first().focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
  const visible = await page.evaluate(() => {
    const caption = document.activeElement.querySelector('.design-caption').getBoundingClientRect();
    const stage = document.querySelector('.app-stage').getBoundingClientRect();
    return caption.top >= stage.top && caption.bottom <= stage.bottom;
  });
  assert.equal(visible, true, 'The focused dock caption stays inside the scroll viewport');
  await page.close();
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
  for (let row = 0; row < 3; row++) await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator(':focus').getAttribute('data-id'), '9Ur5IzDKqV.TizenYouTube');
  await galleryScroll(page, null);
  const header = await page.locator('#design-date').boundingBox();
  assert.ok((await page.locator(':focus').boundingBox()).y > header.y + header.height, 'Date stays above visible apps with the clock off');
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
  await page.waitForFunction(() => document.querySelector('#preview-art .design-brand-logo')?.src.endsWith('/hbomax.svg'));
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
  await page.waitForFunction(() => document.querySelector('#preview-art .design-brand-logo')?.src.endsWith('/hbomax.svg'));
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

test('S89C layout choices render every layout with matching arrows', async () => {
  const page = await conceptPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.locator('#settings').click();
  assert.equal(await page.locator('#layout-value').textContent(), 'Gallery');
  for (const [name, columns, cells] of [['Gallery', 5, 10], ['Comfortable', 3, 6], ['Compact', 4, 8], ['Cinema', 5, 5], ['Home Shelf', 10, 10]]) {
    await page.locator('#setting-layout').focus();
    assert.equal(await page.locator('#layout-value').textContent(), name);
    assert.equal(await page.locator('#setting-visual > span').count(), cells);
    await page.keyboard.press('Escape');
    const tiles = page.locator('#favorites > button');
    const ids = await tiles.evaluateAll(items => items.map(item => item.dataset.id));
    assert.equal(await page.locator('#favorites').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length), columns);
    assert.equal(await page.locator('.design-caption').count(), name === 'Gallery' || name === 'Cinema' || name === 'Home Shelf' ? ids.length : 0);
    await tiles.first().focus(); await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-id'), name === 'Cinema' ? ids[0] : ids[columns]);
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

test('Gallery Move keeps a single favorite in landscape proportions and cancels without saving', async () => {
  const page = await conceptPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.evaluate(() => localStorage.setItem('minimal-hub.shortcuts.v1', JSON.stringify({ version: 1, apps: [{ id: 'kIciSQlYEM.plex', name: 'Plex' }] })));
  await page.reload();
  const saved = await page.evaluate(() => localStorage.getItem('minimal-hub.shortcuts.v1'));
  await page.locator('#edit-apps').click();
  await page.locator('#editor-list button').first().click();
  await page.locator('#editor-list button').first().click();
  const tile = await page.locator('.tile.moving').boundingBox();
  assert.ok(tile.width / tile.height > 1.5, 'Moving one app retains a landscape tile');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator(':focus').getAttribute('data-id'), 'kIciSQlYEM.plex');
  assert.equal(await page.evaluate(() => localStorage.getItem('minimal-hub.shortcuts.v1')), saved);
  await page.close();
});

test('Cinema shows settled local hero artwork, a complete library and visible utilities at both TV sizes', async () => {
  for (const viewport of [{width:1920,height:1080},{width:960,height:540}]) {
    const page = await conceptPage({viewport,reducedMotion:'reduce'}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url+'/hub?scenario=cinema&reset=1&static=1');
    await page.locator('#cinema-logo:not([hidden])').waitFor();
    assert.match(await page.locator('#cinema-logo').getAttribute('src'),/netflix/);
    await page.locator('#favorites button').nth(3).focus();
    await page.waitForFunction(()=>document.querySelector('#cinema-logo').src.includes('spotify'));
    const order=await page.evaluate(()=>localStorage.getItem('minimal-hub.shortcuts.v1'));
    for(const selector of ['#favorites button:nth-child(5)','#cinema-library-toggle','#edit-apps','#settings']) {
      const box=await page.locator(selector).boundingBox();
      assert.ok(box.y>=0&&box.y+box.height<=viewport.height-4,selector+' must retain room for its focus ring');
    }
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#cinema-hero').isVisible(),false);
    assert.ok(await page.locator('#favorites button').count()>25);
    await page.locator('#favorites button').first().focus();
    for(let i=0;i<9;i++)await page.keyboard.press('ArrowDown');
    const focus=await page.locator(':focus').boundingBox();assert.ok(focus.y>=0&&focus.y+focus.height<=viewport.height);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator(':focus').getAttribute('data-id'),'rJeHak5zRg.Spotify');
    assert.equal(await page.evaluate(()=>localStorage.getItem('minimal-hub.shortcuts.v1')),order);
    await page.locator('#settings').click();await page.locator('#setting-photos').click();await page.keyboard.press('Escape');
    assert.equal(await page.locator('.design-landscape.is-active').count(),0);
    assert.equal(await page.locator('#cinema-hero').isVisible(),true);
    assert.deepEqual(errors,[]);await page.close();
  }
});

test('Cinema waits for settled focus without fetching another landscape and keeps failed hero art readable', async () => {
  const page=await conceptPage({viewport:{width:1920,height:1080}}),photos=[];
  page.on('request',request=>{if(request.url().startsWith('https://images.unsplash.com/'))photos.push(request.url());});
  await page.goto(url+'/hub?scenario=cinema&reset=1&static=1');
  await page.locator('#cinema-logo:not([hidden])').waitFor();
  const initial=photos.length;await page.clock.install();
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  await page.clock.fastForward(100);
  assert.equal(await page.locator('#cinema-name').textContent(),'Netflix');
  await page.clock.fastForward(70);
  assert.equal(await page.locator('#cinema-name').textContent(),'Plex');assert.equal(photos.length,initial);
  await page.close();
  const fallback=await conceptPage({reducedMotion:'reduce'});
  await fallback.route('**/logos/netflix.png',route=>route.abort());
  await fallback.goto(url+'/hub?scenario=cinema&reset=1&static=1');
  await fallback.locator('#cinema-name').filter({hasText:'Netflix'}).waitFor();
  assert.equal(await fallback.locator('#cinema-name').isVisible(),true);
  assert.match(await fallback.locator('#cinema-prompt').textContent(),/open Netflix/);
  await fallback.close();
});

test('Home Shelf keeps tall cases and visible controls at both TV sizes, with smooth row return', async () => {
  for(const viewport of [{width:1920,height:1080},{width:960,height:540}]) {
    const page=await conceptPage({viewport}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url+'/hub?scenario=shelf&reset=1&static=1');
    await page.locator('#cinema-name:not([hidden])').filter({hasText:'Netflix'}).waitFor();
    await page.waitForTimeout(100);
    const grid=page.locator('#favorites'),tile=await grid.locator('button').first().boundingBox();
    assert.ok(tile.height>tile.width*3,'Services must be tall spines');
    assert.equal(await grid.evaluate(g=>getComputedStyle(g).gridTemplateColumns.split(' ').length),10);
    const down=await galleryScroll(page,'ArrowDown','#favorites');
    assert.ok(down.final>down.before);assert.ok(down.positions.some(y=>y>down.before+1&&y<down.final-1));
    const focused=await page.locator(':focus').boundingBox(),frame=await grid.boundingBox();
    assert.ok(focused.y>=frame.y&&focused.y+focused.height<=frame.y+frame.height,'Spines stay inside their viewport');
    for(const input of await page.locator('#favorites .design-input').all()) {
      assert.equal(await input.locator('.brand-wordmark').isVisible(),false,'Input spines show one label');
      assert.equal(await input.locator('.design-caption').isVisible(),true);
    }
    const up=await galleryScroll(page,'ArrowUp','#favorites');assert.equal(up.final,0);
    await page.keyboard.press('ArrowDown');await galleryScroll(page,null,'#favorites');await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-app'),'home');
    for(const selector of ['[data-app="home"]','#edit-apps','#settings']){
      const box=await page.locator(selector).boundingBox();assert.ok(box.y>=0&&box.y+box.height<viewport.height-4);
    }
    await page.locator('#settings').click();await page.locator('#setting-photos').click();await page.keyboard.press('Escape');
    assert.equal(await page.locator('.design-landscape.is-active').count(),0);
    assert.deepEqual(errors,[]);await page.close();
  }
});

test('Home Shelf cases recede along a shared ledge and keep their brand badges decorative', async () => {
  for(const viewport of [{width:1920,height:1080},{width:960,height:540}]) {
    const page=await conceptPage({viewport,reducedMotion:'reduce'});
    await page.goto(url+'/hub?scenario=shelf&reset=1&static=1');
    await page.locator('#cinema-name').filter({hasText:'Netflix'}).waitFor();
    const cases=page.locator('#favorites > button');
    const near=await cases.nth(1).boundingBox(),far=await cases.nth(9).boundingBox();
    assert.ok(near.height-far.height>viewport.height*.04,'Cases recede toward the right');
    assert.ok(Math.abs(near.y+near.height-far.y-far.height)<2,'Case bases share the ledge');
    assert.equal(await page.locator('#favorites .shelf-brand-badge').count(),13);
    for(const badge of await page.locator('#favorites .shelf-brand-badge').all()) {
      assert.equal(await badge.getAttribute('alt'),'');
      assert.equal(await badge.isVisible(),true);
    }
    await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator('#favorites').evaluate(g=>g.scrollTop),0);
    await page.close();
  }
});

test('Home Shelf case material stays solid and preserves the printed service color', async () => {
  for(const viewport of [{width:1920,height:1080},{width:960,height:540}]) {
    const page=await conceptPage({viewport});
    await page.goto(url+'/hub?scenario=shelf&reset=1&static=1');
    await page.locator('#cinema-name').filter({hasText:'Netflix'}).waitFor();
    await page.waitForTimeout(200);
    const tile=page.locator('#favorites > button').nth(9);
    assert.equal(await tile.evaluate(el=>getComputedStyle(el,'::before').mixBlendMode),'normal','The physical side must not blend with scenery or adjacent cases');
    assert.equal(await tile.evaluate(el=>getComputedStyle(el,'::after').mixBlendMode),'normal','Spine shading stays within its own background');
    async function sample(clip) {
      const source='data:image/png;base64,'+(await page.screenshot({clip})).toString('base64');
      return page.evaluate(source=>new Promise((resolve,reject)=>{
        const image=new Image();image.onload=()=>{
          const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
          const context=canvas.getContext('2d');context.drawImage(image,0,0,1,1);
          resolve(Array.from(context.getImageData(0,0,1,1).data).slice(0,3));
        };image.onerror=()=>reject(new Error('Cannot sample the rendered case'));image.src=source;
      }),source);
    }
    for(const reducedMotion of ['no-preference','reduce']) {
      await page.emulateMedia({reducedMotion});
      await tile.focus();await page.waitForTimeout(200);
      const box=await tile.boundingBox();
      const side={x:box.x+box.width*1.1,y:box.y+box.height*.45,width:6,height:6};
      await page.locator('.app-stage').evaluate(el=>el.style.background='#ff00ff');const pink=await sample(side);
      await page.locator('.app-stage').evaluate(el=>el.style.background='#00ff00');const green=await sample(side);
      assert.ok(Math.max(...pink.map((value,i)=>Math.abs(value-green[i])))<12,`Case side let the backdrop through: ${pink} / ${green}`);
    }
    await page.locator('#favorites > button').nth(5).focus();await page.waitForTimeout(200);
    const spine=await page.locator(':focus').boundingBox();
    const color=await sample({x:spine.x+spine.width*.45,y:spine.y+spine.height*.12,width:6,height:6});
    assert.ok(color[1]>color[0]+40,'The printed spine retains its service color');
    await page.close();
  }
});

test('Home Shelf turns a rigid case with a fixed-depth side and an unflattened front', async () => {
  const page=await conceptPage({viewport:{width:1920,height:1080},reducedMotion:'reduce'});
  await page.goto(url+'/hub?scenario=shelf&reset=1&static=1');
  await page.locator('#cinema-name').filter({hasText:'Netflix'}).waitFor();
  const tile=page.locator('#favorites > button').first();
  async function geometry() { return tile.evaluate(el=>{
    const front=getComputedStyle(el),side=getComputedStyle(el,'::before');
    return {style:front.transformStyle,isolation:front.isolation,filter:front.filter,
      width:parseFloat(side.width),turn:new DOMMatrix(side.transform).m13,
      yaw:new DOMMatrix(front.transform).m13};
  }); }
  const pulled=await geometry();
  assert.equal(pulled.style,'preserve-3d','The front and side share a 3D case');
  assert.equal(pulled.isolation,'auto','A grouping property must not flatten the case');
  assert.equal(pulled.filter,'none');assert.ok(Math.abs(pulled.turn)>.99,'The side is perpendicular to the front');
  await page.locator('#favorites > button').nth(1).focus();
  const resting=await geometry();
  assert.ok(Math.abs(pulled.width-resting.width)<1,'Pulling the case keeps its physical depth');
  assert.ok(Math.abs(pulled.yaw)>Math.abs(resting.yaw)+.15,'The pull changes the case angle');
  for(const index of [2,7]) assert.equal(await page.locator('#favorites > button').nth(index).evaluate(el=>getComputedStyle(el,'::after').backgroundBlendMode),'normal, hard-light','Dark service cases retain the stronger leather grain');
  assert.equal(await page.locator('#favorites > button').nth(4).evaluate(el=>getComputedStyle(el,'::after').backgroundBlendMode),'normal, soft-light','White cases keep a softer texture');
  await page.close();
});

test('Home Shelf gives the pulled case room and keeps other rows in place', async () => {
  for(const viewport of [{width:1920,height:1080},{width:960,height:540}]) {
    const page=await conceptPage({viewport,reducedMotion:'reduce'});
    await page.goto(url+'/hub?scenario=shelf&reset=1&static=1');
    await page.locator('#cinema-name').filter({hasText:'Netflix'}).waitFor();
    const cases=page.locator('#favorites > button');
    for(const selected of [0,5,8]) {
      await cases.nth(selected).focus();
      const current=await cases.nth(selected).boundingBox(),next=await cases.nth(selected+1).boundingBox();
      assert.ok(next.x-current.x-current.width>viewport.width*.03,'The pulled case exposes a broad side beside its neighbor');
    }
    const otherRow=await cases.nth(11).boundingBox();
    await page.locator('#settings').focus();
    assert.ok(Math.abs((await cases.nth(11).boundingBox()).x-otherRow.x)<1,'Pulling a case only moves its own row');
    await cases.nth(9).focus();
    const last=await cases.nth(9).boundingBox(),grid=await page.locator('#favorites').boundingBox();
    assert.ok(last.x+last.width+viewport.width*.045<grid.x+grid.width,'The final case has room for its exposed side');
    await page.close();
  }
});

test('Home Shelf keeps the common case body opaque between services through the ledge', async () => {
  for(const viewport of [{width:1920,height:1080},{width:960,height:540}]) {
    const page=await conceptPage({viewport});
    await page.goto(url+'/hub?scenario=shelf&reset=1&static=1');
    await page.locator('#cinema-name').filter({hasText:'Netflix'}).waitFor();
    await page.locator('#favorites > button').nth(16).waitFor();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('#favorites img')).every(img=>img.complete&&img.naturalWidth));
    await page.locator('#settings').focus();
    await page.evaluate(()=>document.querySelector('#favorites').getAnimations({subtree:true}).forEach(animation=>animation.finish()));
    await page.locator('.app-stage').evaluate(el=>el.style.background='#ff00ff');
    const cases=page.locator('#favorites > button');
    async function checkGaps(selected,phase) {
        const boxes=await cases.evaluateAll(items=>items.slice(0,10).map(el=>{
          const box=el.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height};
        }));
        const x=Math.ceil(boxes[0].x)+3,right=Math.floor(boxes[9].x+boxes[9].width)-3;
        // The far top recedes 13.6% at this depth; inspect below the sloped contour.
        const y=Math.ceil(Math.max(...boxes.map(b=>b.y))+Math.min(...boxes.map(b=>b.height))*.15);
        const bottom=Math.floor(Math.min(...boxes.map(b=>b.y+b.height)))-2;
        const sources=[];
        for(const color of ['#ff00ff','#00ff00']) {
          await page.locator('.app-stage').evaluate((el,color)=>el.style.background=color,color);
          sources.push('data:image/png;base64,'+(await page.screenshot({clip:{x,y,width:right-x,height:bottom-y}})).toString('base64'));
        }
        const gaps=await page.evaluate(async sources=>{
          function pixels(source) { return new Promise((resolve,reject)=>{
            const image=new Image();image.onload=()=>{
              const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
              const context=canvas.getContext('2d');context.drawImage(image,0,0);
              resolve(context.getImageData(0,0,canvas.width,canvas.height).data);
            };image.onerror=()=>reject(new Error('Cannot inspect case spacing'));image.src=source;
          }); }
          const [pink,green]=await Promise.all(sources.map(pixels));let exposed=0;
          for(let i=0;i<pink.length;i+=4) if(pink[i]-green[i]>12&&green[i+1]-pink[i+1]>12&&pink[i+2]-green[i+2]>12) exposed++;
          return exposed;
        },sources);
        if(gaps) {
          const diagnostic=path.resolve(__dirname,`../test-results/shelf-gap-${viewport.width}.png`);
          await fs.mkdir(path.dirname(diagnostic),{recursive:true});await page.screenshot({path:diagnostic});
          for(let index=0;index<sources.length;index++) await fs.writeFile(diagnostic+`.${index}.png`,Buffer.from(sources[index].split(',')[1],'base64'));
          await fs.writeFile(diagnostic+'.json',JSON.stringify({selected,phase,x,right,y,bottom,boxes,gaps},null,2));
        }
        assert.equal(gaps,0,`Back wall is visible with selection ${selected} at ${viewport.width}px (${phase})`);
    }
    for(const reducedMotion of ['no-preference','reduce']) {
      await page.emulateMedia({reducedMotion});
      for(const selected of [0,1,0,5,9,8,-1,9,0]) {
        const transitions=await page.evaluate(async selected=>{
          const target=selected<0?document.querySelector('#settings'):document.querySelectorAll('#favorites > button')[selected];
          target.focus({preventScroll:true});
          window.shelfTransitions=document.querySelector('#favorites').getAnimations({subtree:true});
          window.shelfTransitions.forEach(animation=>{animation.pause();animation.currentTime=0;});
          await Promise.all(window.shelfTransitions.map(animation=>animation.ready));
          return window.shelfTransitions.length;
        },selected);
        if(reducedMotion==='no-preference'&&selected===1) assert.ok(transitions>0,'Frame sampling must inspect active case transitions');
        for(const time of reducedMotion==='reduce'?[160]:[0,40,80,120,160]) {
          await page.evaluate(time=>window.shelfTransitions.forEach(animation=>{animation.currentTime=time;}),time);
          await checkGaps(selected,`${reducedMotion}, ${time}ms`);
        }
        // Reverse the adjacent move halfway through to cover repeated remote arrows.
        await page.evaluate(selected=>window.shelfTransitions.forEach(animation=>{
          if(selected===1) animation.currentTime=80;else animation.finish();
        }),selected);
      }
    }
    await page.close();
  }
});

test('the transparent Disney wordmark stays white on Shelf, editor rows and Cinema', async () => {
  const page=await conceptPage({reducedMotion:'reduce'});
  await page.goto(url+'/hub?scenario=shelf&reset=1&static=1');
  const logo=page.locator('#favorites .brand-disney .design-brand-logo');await logo.waitFor();
  assert.equal(await logo.evaluate(el=>getComputedStyle(el).filter),'invert(1)');
  await page.locator('#edit-apps').click();
  const row=page.locator('.design-row-logo[src$="disney.png"]');await row.waitFor();
  assert.equal(await row.evaluate(el=>getComputedStyle(el).filter),'invert(1)');
  await row.locator('..').focus();
  assert.equal(await row.evaluate(el=>getComputedStyle(el).filter),'none','The focused pale row uses the black wordmark');
  await page.goto(url+'/hub?scenario=cinema&reset=1&static=1');
  await page.locator('#favorites > button').nth(1).focus();
  const hero=page.locator('#cinema-logo[src$="disney.png"]');await hero.waitFor({state:'visible'});
  assert.equal(await hero.evaluate(el=>getComputedStyle(el).filter),'invert(1)');await page.close();
});

test('Home Shelf workbench initializes its artwork after reset and reload', async () => {
  const page=await conceptPage(),errors=[];page.on('pageerror',error=>errors.push(error.stack));
  await page.goto(url+'/?scenario=shelf');
  const hub=page.frameLocator('#hub');
  await hub.locator('#favorites > button').nth(16).waitFor();
  await page.getByRole('button',{name:'Reset scenario',exact:true}).click();
  await hub.locator('.shelf-brand-badge').nth(12).waitFor();
  await page.reload();await hub.locator('.shelf-brand-badge').nth(12).waitFor();
  assert.deepEqual(errors,[]);await page.close();
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

test('returning Home keeps the photo and resumes its remaining visible rotation time', async () => {
  const page = await conceptPage();
  let requests = 0;
  await page.route('https://images.unsplash.com/**', route => {
    requests++;
    return route.fulfill({ contentType: 'image/png', body: landscapePixel });
  });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  const active = page.locator('.design-landscape.is-active');
  await active.waitFor();
  const first = await active.getAttribute('src');
  await page.clock.runFor(20_000);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(120_000);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(requests, 1, 'Returning Home must reuse the downloaded photo');
  assert.equal(await active.getAttribute('src'), first);
  await page.clock.runFor(39_900);
  assert.equal(requests, 1, 'Time spent in another app must not consume the photo interval');
  const rotated = page.waitForRequest('https://images.unsplash.com/**');
  await page.clock.runFor(200);
  await rotated;
  await page.waitForFunction(first => document.querySelector('.design-landscape.is-active').src !== first, first);
  assert.equal(requests, 2);
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
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(requests.length, count);
  const resumed = page.waitForRequest('https://images.unsplash.com/**');
  await page.clock.fastForward(60_100);
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

test('S89C advertised Spotify and Tubi names select their logos across Home and editing', async () => {
  const page = await conceptPage({ viewport: { width: 1920, height: 1080 } });
  await page.route('**/preview/fixtures.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: require('node:fs').readFileSync(path.resolve(__dirname, '../preview/fixtures.js'), 'utf8')
      .replace("'Spotify']", "'Spotify - Music and Podcasts']")
      .replace("'Tubi']", "'Tubi - Free Movies ＆ TV']")
  }));
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  for (const [name, file] of [['Spotify - Music and Podcasts', 'spotify.svg'], ['Tubi - Free Movies ＆ TV', 'tubi.png']]) {
    const tile = page.getByRole('button', { name: 'Open ' + name, exact: true });
    await tile.locator('.design-brand-logo').waitFor({ timeout: 2000 });
    assert.match(await tile.locator('.design-brand-logo').getAttribute('src'), new RegExp(file.replace('.', '\\.')));
    await page.locator('#edit-apps').click();
    const row = page.locator('#editor-list .app-row').filter({ has: page.locator('.row-name', { hasText: name }) });
    await row.focus();
    await row.locator('.design-row-logo').waitFor({ timeout: 2000 });
    await page.waitForFunction(file => {
      const image = document.querySelector('#preview-art .design-brand-logo');
      return image && image.src.endsWith('/' + file) && image.complete && image.naturalWidth > 0;
    }, file, { timeout: 2000 });
    await page.keyboard.press('Escape');
  }
  await page.close();
});

test('HBO Max and Sling use transparent wordmarks integrated with the tile', async () => {
  const page = await conceptPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.locator('#edit-apps').click();
  await page.locator('#editor-actions button').first().click();
  for (const name of ['HBO Max', 'Sling TV']) {
    await page.locator('#editor-list .app-row').filter({ has: page.locator('.row-name', { hasText: new RegExp('^' + name + '$') }) }).click();
  }
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  for (const name of ['HBO Max', 'Sling TV']) {
    const tile = page.getByRole('button', { name: 'Open ' + name, exact: true });
    await tile.locator('.design-brand-logo').waitFor();
    const art = await tile.evaluate(card => {
      const image = card.querySelector('.design-brand-logo'), box = image.getBoundingClientRect(), frame = card.getBoundingClientRect();
      return { source: image.getAttribute('src'), fit: getComputedStyle(image).objectFit, width: box.width / frame.width, height: box.height / frame.height };
    });
    assert.match(art.source, /\.(svg|png)$/, name + ' uses its transparent wordmark');
    if (name === 'HBO Max') {
      assert.equal(art.fit, 'contain');
      assert.ok(art.width < .9 && art.height < .9, 'HBO Max keeps clear space inside the tile');
    } else {
      assert.equal(art.fit, 'cover', 'The transparent Sling artcard fills the tile without an inset icon');
    }
  }
  await page.close();
});

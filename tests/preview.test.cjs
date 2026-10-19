const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { start } = require('../preview/server.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
let server, url, browser;
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

test('shared preview mock persists monitoring preferences without contacting a receiver', async () => {
  const page = await browser.newPage();
  await page.goto(url + '/hub?scenario=monitoring&reset=1&static=1');
  await page.locator('#telemetry-enabled').click();
  await page.locator('#telemetry-endpoint').fill('https://example.test/v1/s90d');
  await page.locator('#telemetry-save').click();
  await page.reload();
  assert.equal(await page.locator('#telemetry-endpoint').inputValue(), 'https://example.test/v1/s90d');
  assert.equal(await page.locator('#telemetry-enabled').getAttribute('aria-pressed'), 'true');
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
    const page = await browser.newPage({ viewport });
    await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
    await page.locator('body.design-tvos').waitFor({ timeout: 2000 });
    assert.equal(await page.locator('#favorites > button').count(), 15);
    assert.equal(await page.locator('#home-clock').isVisible(), true);
    await page.locator('#favorites > button').first().focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-id'), 'rJeHak5zRg.Spotify');
    await page.keyboard.press('ArrowDown');
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

test('design respects the existing layout setting and Move grid geometry', async () => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(url + '/hub?scenario=tvos-concept&reset=1&static=1');
  await page.locator('.design-caption').nth(14).waitFor();
  await page.locator('#settings').click();
  await page.locator('#setting-layout').click();
  await page.keyboard.press('Escape');
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
  const page = await browser.newPage();
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

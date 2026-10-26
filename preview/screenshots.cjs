const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { start } = require('./server.cjs');
const scenarios = require('./scenarios.js');

async function main() {
  const small = process.argv.includes('--small');
  const photos = process.argv.includes('--photos');
  const viewport = small ? { width: 960, height: 540 } : { width: 1920, height: 1080 };
  const output = path.resolve(__dirname, `../test-results/screenshots${small ? '-960' : ''}${photos ? '-photos' : ''}`);
  await fs.mkdir(output, { recursive: true });
  const { server, url } = await start(0);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const name of Object.keys(scenarios)) {
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/Los_Angeles' });
      if (!photos) await page.route('https://images.unsplash.com/**', route => route.abort());
      // Fixed clock and disabled screenshot animations keep review captures comparable.
      await page.clock.setFixedTime(new Date(name === 'shelf' ? '2026-10-20T17:41:00Z' : name === 'tvos-concept' ? '2026-10-20T02:41:00Z' : '2026-01-01T12:00:00Z'));
      await page.goto(`${url}/hub?scenario=${name}&reset=1&static=1`);
      await page.waitForFunction(() => /SIMULATED|DESIGN MOCKUP/.test(document.getElementById('preview').textContent));
      await page.waitForFunction(() => !document.body.textContent.includes('Checking installed apps…'));
      await page.waitForTimeout(100); // Simulated discovery answers after 20 ms and may redraw Home.
      if (scenarios[name].design) {
        if (photos) await page.locator('.design-landscape.is-active').waitFor({ timeout: 20000 });
        await page.locator('#favorites > button').first().focus();
        if (name === 'tvos-concept') { await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); }
        else if (name === 'cinema') await page.locator('#cinema-logo:not([hidden])').waitFor();
        else await page.locator('#cinema-name:not([hidden])').waitFor();
      }
      await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
      if (name === 'tvos-concept') {
        for (let row = 0; row < 3; row++) await page.keyboard.press('ArrowDown');
        await page.screenshot({ path: path.join(output, 'tvos-concept-footer.png'), animations: 'disabled' });
        await page.keyboard.press('Enter');
        await page.screenshot({ path: path.join(output, 'tvos-concept-settings.png'), animations: 'disabled' });
        await page.keyboard.press('Escape'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter');
        await page.screenshot({ path: path.join(output, 'tvos-concept-edit.png'), animations: 'disabled' });
      }
      if (name === 'cinema') {
        await page.keyboard.press('ArrowDown');
        await page.screenshot({ path: path.join(output, 'cinema-library.png'), animations: 'disabled' });
        for (let row = 0; row < 6; row++) await page.keyboard.press('ArrowDown');
        await page.screenshot({ path: path.join(output, 'cinema-inputs.png'), animations: 'disabled' });
        await page.locator('#settings').click();
        await page.locator('#setting-layout').focus();
        await page.screenshot({ path: path.join(output, 'cinema-settings.png'), animations: 'disabled' });
        await page.keyboard.press('Escape'); await page.locator('#edit-apps').click();
        await page.screenshot({ path: path.join(output, 'cinema-edit.png'), animations: 'disabled' });
      }
      if (name === 'shelf') {
        await page.keyboard.press('ArrowDown');
        await page.screenshot({ path: path.join(output, 'shelf-second-row.png'), animations: 'disabled' });
        await page.locator('#settings').click(); await page.locator('#setting-layout').focus();
        await page.screenshot({ path: path.join(output, 'shelf-settings.png'), animations: 'disabled' });
        await page.keyboard.press('Escape'); await page.locator('#edit-apps').click();
        await page.screenshot({ path: path.join(output, 'shelf-edit.png'), animations: 'disabled' });
      }
      await page.close();
    }
    console.log(`Saved ${Object.keys(scenarios).length + 10} review screenshots to ${output}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const { start } = require('./server.cjs');
const scenarios = require('./scenarios.js');

async function main() {
  const small = process.argv.includes('--small');
  const viewport = small ? { width: 960, height: 540 } : { width: 1920, height: 1080 };
  const output = path.resolve(__dirname, small ? '../test-results/screenshots-960' : '../test-results/screenshots');
  await fs.mkdir(output, { recursive: true });
  const { server, url } = await start(0);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const name of Object.keys(scenarios)) {
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
      await page.route('https://images.unsplash.com/**', route => route.abort());
      // Fixed clock and disabled screenshot animations keep review captures comparable.
      await page.clock.setFixedTime(new Date('2026-01-01T12:00:00Z'));
      await page.goto(`${url}/hub?scenario=${name}&reset=1&static=1`);
      await page.waitForFunction(() => /SIMULATED|DESIGN MOCKUP/.test(document.getElementById('preview').textContent));
      await page.waitForFunction(() => !document.body.textContent.includes('Checking installed apps…'));
      await page.waitForTimeout(100); // Simulated discovery answers after 20 ms and may redraw Home.
      await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
      await page.close();
    }
    console.log(`Saved ${Object.keys(scenarios).length} review screenshots to ${output}`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

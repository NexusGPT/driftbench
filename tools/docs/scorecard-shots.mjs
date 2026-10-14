#!/usr/bin/env node
/**
 * Draws the README pictures of the scorecard, docs/assets/scorecard-dark.png and scorecard-light.png, from a
 * scorecard page written by `driftbench report`: the numbers, the versions, the charts and the start of the
 * tests list, at 1180 CSS pixels wide and 2x, headless Chromium.
 *
 *   node tools/docs/scorecard-shots.mjs [examples/acme/reports/acme-faults.html]
 *
 * The page is the committed Acme fault report by default: fictional data only.
 */
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const page = resolve(process.argv[2] ?? join(ROOT, 'examples/acme/reports/acme-faults.html'));
const WIDTH = 1180;

const browser = await chromium.launch({ headless: true });
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({
      viewport: { width: WIDTH, height: 1000 },
      deviceScaleFactor: 2,
    });
    const tab = await context.newPage();
    const errors = [];
    tab.on('pageerror', (error) => errors.push(String(error)));
    await tab.goto(pathToFileURL(page).href);
    await tab.evaluate(() => document.fonts.ready);
    if (theme === 'light') await tab.click('label.theme-btn');
    // Down to the second test row: the numbers, the charts and the start of the tests list.
    const bottom = await tab.evaluate(() => {
      const rows = document.querySelectorAll('#tests details.test');
      const last = rows[Math.min(1, rows.length - 1)];
      return Math.ceil(
        (last ?? document.getElementById('tests')).getBoundingClientRect().bottom + window.scrollY + 24,
      );
    });
    const out = join(ROOT, 'docs/assets', `scorecard-${theme}.png`);
    await tab.screenshot({ path: out, clip: { x: 0, y: 0, width: WIDTH, height: bottom }, fullPage: true });
    if (errors.length > 0) throw new Error(`the page reported ${errors.join(' | ')}`);
    process.stdout.write(`Wrote ${out} (${WIDTH * 2} x ${bottom * 2})\n`);
    await context.close();
  }
} finally {
  await browser.close();
}

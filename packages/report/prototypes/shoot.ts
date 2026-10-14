/**
 * Screenshots each prototype page in light and dark, headless Chromium (playwright-core), and reports any
 * console error and sideways scroll.
 *
 *   pnpm exec tsx packages/report/prototypes/shoot.ts --dir <dir> [--width 1280] [--full]
 */
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    width: { type: 'string', default: '1280' },
    full: { type: 'boolean', default: false },
    only: { type: 'string' },
    anchors: { type: 'string' },
    schemes: { type: 'string', default: 'light,dark' },
  },
});
if (!values.dir) {
  process.stderr.write('Give --dir.\n');
  process.exit(2);
}
const dir = resolve(values.dir);
const width = Number(values.width);
const files = (await readdir(dir)).filter(
  (f) => f.startsWith('option-') && f.endsWith('.html') && (!values.only || f.includes(values.only)),
);
const browser = await chromium.launch({ headless: true });
let problems = 0;
try {
  for (const file of files) {
    for (const scheme of (values.schemes ?? 'light,dark').split(',') as ('light' | 'dark')[]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: scheme,
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(String(err)));
      await page.goto(`file://${join(dir, file)}`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const out = join(dir, `${file.replace('.html', '')}-${scheme}${width !== 1280 ? `-${width}` : ''}.png`);
      await page.screenshot({ path: out, fullPage: values.full ?? false, timeout: 120000 });
      for (const anchor of (values.anchors ?? '').split(',').filter(Boolean)) {
        const found = await page.evaluate((id) => {
          const el = document.getElementById(id);
          if (!el) return false;
          el.scrollIntoView({ block: 'start' });
          window.scrollBy(0, -16);
          return true;
        }, anchor);
        if (!found) {
          process.stdout.write(`  no element #${anchor} in ${file}\n`);
          continue;
        }
        await page.screenshot({
          path: join(dir, `${file.replace('.html', '')}-${scheme}-${anchor}.png`),
          timeout: 120000,
        });
      }
      const wideEls = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const r = el.getBoundingClientRect();
          if (r.right > limit + 1 && out.length < 5)
            out.push(
              `${el.tagName.toLowerCase()}.${(el as HTMLElement).className?.toString().slice(0, 40)} right=${Math.round(r.right)}`,
            );
        }
        return out;
      });
      if (wideEls.length > 0) process.stdout.write(`  wide: ${wideEls.join(' ; ')}\n`);
      process.stdout.write(
        `${out}: height ${height}px${wide ? ', SIDEWAYS SCROLL' : ''}${errors.length > 0 ? `, ${errors.length} console errors: ${errors.join(' | ')}` : ''}\n`,
      );
      if (wide || errors.length > 0) problems += 1;
      await context.close();
    }
  }
} finally {
  await browser.close();
}
process.exit(problems > 0 ? 1 : 0);

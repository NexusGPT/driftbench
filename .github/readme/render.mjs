#!/usr/bin/env node
// Renders the README images from the HTML sources in ./src.
//
// The tools live outside the repo, so the project keeps no rendering
// dependencies. One time setup:
//
//   mkdir -p /tmp/driftbench-readme-tools && cd /tmp/driftbench-readme-tools
//   npm init -y && npm install --include=optional playwright@1.64.0 sharp@0.34.3
//   npx playwright install chromium
//
// --include=optional brings sharp's native binary for the platform, even when
// the npm config omits optional packages. Playwright 1.64.0 drives Chromium 1248.
//
// Then, from the repo root:
//
//   README_TOOLS=/tmp/driftbench-readme-tools node .github/readme/render.mjs
//   README_TOOLS=/tmp/driftbench-readme-tools node .github/readme/render.mjs council kinds
//
// Every image renders headless at deviceScaleFactor 2. Figures render twice,
// light and dark: light on SilkRow silk, dark on DeepBlue silk, with transparent
// corners. The hero is built from the anatomy figure: see anatomy/build.mjs and anatomy/capture.mjs.
// Brand assets (silk stills in src/silk, the two logo files) are copies from the
// Nexus design system v1; this script never writes them.
//
// A render fails when a page throws, a font does not load, or text runs past
// its box or past the image edge. Each PNG stays under 600 KB.

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'src');
const tools = process.env.README_TOOLS || '/tmp/driftbench-readme-tools';
const require = createRequire(path.join(tools, 'package.json'));
const { chromium } = require('playwright');
const sharp = require('sharp');

const BUDGET = 600 * 1024;

const jobs = [
  { name: 'areas', src: 'areas.html', out: 'areas-{theme}.png' },
  { name: 'block', src: 'block.html', out: 'block-{theme}.png' },
  { name: 'modes', src: 'modes.html', out: 'modes-{theme}.png' },
  { name: 'perturbed', src: 'perturbed.html', out: 'perturbed-{theme}.png' },
  { name: 'council', src: 'council.html', out: 'council-{theme}.png' },
  { name: 'kinds', src: 'kinds.html', out: 'kinds-{theme}.png' },
  { name: 'loop', src: 'loop.html', out: 'loop-{theme}.png' },
  { name: 'eval-what', src: 'eval-what.html', out: 'eval-what-{theme}.png' },
  { name: 'by-hand', src: 'by-hand.html', out: 'by-hand-{theme}.png' },
  { name: 'problems', src: 'problems.html', out: 'problems-{theme}.png' },
  { name: 'loop-steps', src: 'loop-steps.html', out: 'loop-steps-{theme}.png' },
  { name: 'blocks-diff', src: 'blocks-diff.html', out: 'blocks-diff-{theme}.png' },
  { name: 'gen', src: 'gen.html', out: 'gen-{theme}.png' },
  { name: 'innovations', src: 'innovations.html', out: 'innovations-{theme}.png' },
  { name: 'moj', src: 'moj.html', out: 'moj-{theme}.png' },
  { name: 'blast', src: 'blast.html', out: 'blast-{theme}.png' },
  { name: 'rule-links', src: 'rule-links.html', out: 'rule-links-{theme}.png' },
  { name: 'block-sources', src: 'block-sources.html', out: 'block-sources-{theme}.png' },
  { name: 'block-personas', src: 'block-personas.html', out: 'block-personas-{theme}.png' },
  { name: 'block-parents', src: 'block-parents.html', out: 'block-parents-{theme}.png' },
  { name: 'block-values', src: 'block-values.html', out: 'block-values-{theme}.png' },
  { name: 'block-rules', src: 'block-rules.html', out: 'block-rules-{theme}.png' },
  // The charts: one page, chart.html?c=<name>, reading chart-data.js (written by tools/readme-charts.mjs).
  // The five public benchmark charts render into docs/assets, where the README and the docs site both read them.
  { name: 'judge-leads', src: 'chart.html', query: 'c=judge-leads', out: 'judge-leads-{theme}.png' },
  { name: 'judge-cost', src: 'chart.html', query: 'c=judge-cost', out: 'judge-cost-{theme}.png' },
  { name: 'mm-eval-sealed-test', src: 'chart.html', query: 'c=mm-eval-sealed-test', out: 'mm-eval-sealed-test-{theme}.png' },
  { name: 'capability-matrix', src: 'chart.html', query: 'c=capability-matrix', out: 'capability-matrix-{theme}.png' },
  { name: 'hard-deepeval', src: 'chart.html', query: 'c=hard-deepeval', out: 'hard-deepeval-{theme}.png' },
  { name: 'hard-promptfoo', src: 'chart.html', query: 'c=hard-promptfoo', out: 'hard-promptfoo-{theme}.png' },
  { name: 'hard-langfuse', src: 'chart.html', query: 'c=hard-langfuse', out: 'hard-langfuse-{theme}.png' },
  { name: 'summary', src: 'summary.html', out: '../../docs/assets/summary-{theme}.png' },
  { name: 'bench-judgebench', src: 'chart.html', query: 'c=bench-judgebench', out: '../../docs/assets/bench-judgebench-{theme}.png' },
  { name: 'bench-judgebench-models', src: 'chart.html', query: 'c=bench-judgebench-models', out: '../../docs/assets/bench-judgebench-models-{theme}.png' },
  { name: 'bench-mm-eval', src: 'chart.html', query: 'c=bench-mm-eval', out: '../../docs/assets/bench-mm-eval-{theme}.png' },
  { name: 'bench-mm-eval-models', src: 'chart.html', query: 'c=bench-mm-eval-models', out: '../../docs/assets/bench-mm-eval-models-{theme}.png' },
  { name: 'bench-rubricbench', src: 'chart.html', query: 'c=bench-rubricbench', out: '../../docs/assets/bench-rubricbench-{theme}.png' },
  { name: 'bench-rubricbench-models', src: 'chart.html', query: 'c=bench-rubricbench-models', out: '../../docs/assets/bench-rubricbench-models-{theme}.png' },
  { name: 'bench-verify', src: 'chart.html', query: 'c=bench-verify', out: '../../docs/assets/bench-verify-{theme}.png' },
  { name: 'bench-verify-models', src: 'chart.html', query: 'c=bench-verify-models', out: '../../docs/assets/bench-verify-models-{theme}.png' },
  { name: 'bench-writing', src: 'chart.html', query: 'c=bench-writing', out: '../../docs/assets/bench-writing-{theme}.png' },
  { name: 'bench-writing-models', src: 'chart.html', query: 'c=bench-writing-models', out: '../../docs/assets/bench-writing-models-{theme}.png' },
];

const wanted = process.argv.slice(2);
const selected = wanted.length ? jobs.filter((j) => wanted.includes(j.name)) : jobs;
if (!selected.length) {
  console.error(`No job matches: ${wanted.join(', ')}. Known: ${jobs.map((j) => j.name).join(', ')}`);
  process.exit(1);
}

async function encode(png, job) {
  if (job.jpeg) {
    for (const quality of [86, 82, 78, 74]) {
      const buf = await sharp(png).jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
      if (buf.length <= BUDGET) return buf;
    }
    throw new Error(`${job.name}: JPG stays over budget`);
  }
  const lossless = await sharp(png).png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 }).toBuffer();
  if (lossless.length <= BUDGET * 0.9) return lossless;
  const palette = await sharp(png).png({ palette: true, quality: 95, effort: 10, dither: 0.5, compressionLevel: 9 }).toBuffer();
  if (palette.length <= BUDGET) return palette;
  throw new Error(`${job.name}: PNG stays over budget (${Math.round(palette.length / 1024)} KB)`);
}

const browser = await chromium.launch({ headless: true });
let failed = 0;
try {
  for (const job of selected) {
    for (const theme of job.themes || ['light', 'dark']) {
      const context = await browser.newContext({
        deviceScaleFactor: 2,
        viewport: { width: 1800, height: 1200 },
        colorScheme: theme,
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(pathToFileURL(path.join(src, job.src)).href + (job.query ? `?${job.query}` : ''), { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
      // Each source lists the faces it uses in window.__fonts and loads them before it is ready.
      const missing = await page.evaluate(() => (window.__fonts || ['400 16px Inter'])
        .filter((f) => !document.fonts.check(f)));
      if (missing.length) errors.push(`fonts not loaded: ${missing.join(', ')}`);
      // No text may be clipped: flag any element whose content runs past its own box, or any box past the frame.
      const clipped = await page.evaluate(() => {
        const frame = document.getElementById('frame');
        const fr = frame.getBoundingClientRect();
        const out = [];
        for (const el of frame.querySelectorAll('*')) {
          if (el.closest('svg')) continue;
          const name = (el.className && el.className.baseVal === undefined ? el.className : '') || el.tagName.toLowerCase();
          // Tolerances: 2 px across, 6 px down. Serif and mono glyphs at line height 1 overhang their line box by
          // up to 5 px and nothing clips them; a cut row or a chip pushed out of its panel overflows by more.
          if (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 6) {
            if (el.clientWidth > 0 && el.clientHeight > 0) out.push(`${name} content ${el.scrollWidth}x${el.scrollHeight} in box ${el.clientWidth}x${el.clientHeight}`);
          }
          const b = el.getBoundingClientRect();
          if (b.width && (b.left < fr.left - 1 || b.right > fr.right + 1 || b.top < fr.top - 1 || b.bottom > fr.bottom + 1)) out.push(`${name} outside the frame`);
        }
        return out;
      });
      if (clipped.length) errors.push(`clipped: ${clipped.slice(0, 6).join(' | ')}`);
      const frame = page.locator('#frame');
      const png = await frame.screenshot({ type: 'png', omitBackground: !job.jpeg, animations: 'disabled' });
      const out = job.out.replace('{theme}', theme);
      const buf = await encode(png, job);
      fs.writeFileSync(path.join(here, out), buf);
      const meta = await sharp(buf).metadata();
      console.log(`${out.padEnd(26)} ${String(meta.width).padStart(5)} x ${String(meta.height).padEnd(5)} ${String(Math.round(buf.length / 1024)).padStart(4)} KB`);
      if (errors.length) {
        failed++;
        console.error(`  ${job.name} (${theme}): ${errors.join(' | ')}`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);

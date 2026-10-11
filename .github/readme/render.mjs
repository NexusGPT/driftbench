#!/usr/bin/env node
// Renders the README images from the HTML sources in ./src.
//
// The tools live outside the repo, so the project keeps no rendering
// dependencies. One time setup:
//
//   mkdir -p /tmp/driftbench-readme-tools && cd /tmp/driftbench-readme-tools
//   npm init -y && npm install playwright@1.64.0 sharp@0.34.3
//   npx playwright install chromium
//
// Then, from the repo root:
//
//   README_TOOLS=/tmp/driftbench-readme-tools node .github/readme/render.mjs
//   README_TOOLS=/tmp/driftbench-readme-tools node .github/readme/render.mjs hero council
//
// Every image renders headless at deviceScaleFactor 2. Figures render twice,
// light and dark, on a transparent canvas. The hero has its own background and
// renders once, as a JPG.

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
  { name: 'hero', src: 'hero.html', out: 'hero.jpg', themes: ['light'], jpeg: true },
  { name: 'areas', src: 'areas.html', out: 'areas-{theme}.png' },
  { name: 'block', src: 'block.html', out: 'block-{theme}.png' },
  { name: 'modes', src: 'modes.html', out: 'modes-{theme}.png' },
  { name: 'perturbed', src: 'perturbed.html', out: 'perturbed-{theme}.png' },
  { name: 'council', src: 'council.html', out: 'council-{theme}.png' },
  { name: 'kinds-chat', src: 'kinds-chat.html', out: 'kinds-chat-{theme}.png' },
  { name: 'kinds-code', src: 'kinds-code.html', out: 'kinds-code-{theme}.png' },
];

const wanted = process.argv.slice(2);
const selected = wanted.length ? jobs.filter((j) => wanted.includes(j.name)) : jobs;
if (!selected.length) {
  console.error(`No job matches: ${wanted.join(', ')}. Known: ${jobs.map((j) => j.name).join(', ')}`);
  process.exit(1);
}

// The footer logo: the source SVG for light pages, a light ink copy for dark pages.
function writeLogos() {
  const logo = fs.readFileSync(path.join(src, 'nexus-logo.svg'), 'utf8');
  fs.writeFileSync(path.join(here, 'nexus-logo-light.svg'), logo);
  fs.writeFileSync(path.join(here, 'nexus-logo-dark.svg'), logo.replaceAll('#0E1116', '#E8EDF3'));
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
  writeLogos();
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
      await page.goto(pathToFileURL(path.join(src, job.src)).href, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
      // Each source lists the faces it uses in window.__fonts and loads them before it is ready.
      const missing = await page.evaluate(() => (window.__fonts || ['400 16px Inter'])
        .filter((f) => !document.fonts.check(f)));
      if (missing.length) errors.push(`fonts not loaded: ${missing.join(', ')}`);
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

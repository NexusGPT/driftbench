/**
 * The viewer's browser journey: a real headless Chromium drives `driftbench view` over a fresh Acme store,
 * at 1280 and 390 px. It opens the campaigns, a campaign's scorecard, a failing run, saves a label on a
 * block, reads it back on the page and from the labels file, and compares two campaigns. On every page it
 * requires no console error, no request off the viewer, and no sideways scroll.
 *
 *   pnpm exec tsx tools/browser/viewer-journey.ts [--out <dir>]
 *
 * Chromium comes from `pnpm exec playwright-core install chromium`. Exit 0 when every step holds, 1 when
 * one does not (each failure is printed), 2 when the browser cannot start. Screenshots and a JSON record
 * go to --out (default _captures/viewer-journey). No model is called: the agents run in process.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadLabels } from '@agent-nexus/driftbench-judges';
import { openStore } from '@agent-nexus/driftbench-store';
import { type Browser, chromium } from 'playwright-core';
import { main } from '../../packages/cli/src/index';
import { startViewer } from '../../packages/cli/src/view/server';
import { storeAcmeCampaign } from '../../packages/report/test/support';

const { values } = parseArgs({ options: { out: { type: 'string', default: '_captures/viewer-journey' } } });
const out = resolve(values.out ?? '_captures/viewer-journey');
await mkdir(out, { recursive: true });

const failures: string[] = [];
const record: Array<Record<string, unknown>> = [];
const expect = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
};

const dir = await mkdtemp(join(tmpdir(), 'driftbench-viewer-journey-'));
const db = join(dir, 'store.db');
const labels = join(dir, 'labels');
const store = openStore(db);
try {
  await storeAcmeCampaign(store, { campaignId: 'c-acme', modes: ['F'], repeats: 1 });
  await storeAcmeCampaign(store, {
    campaignId: 'c-acme-x3',
    modes: ['F'],
    repeats: 1,
    fault: 'x3-skips-recap',
    createdAt: '2026-10-11T13:00:00.000Z',
  });
} finally {
  await store.close();
}
const queued = await main(['queue', 'create', '--store', db, '--campaign', 'c-acme-x3', '--labels', labels], {
  out: () => {},
  err: (text) => failures.push(`queue create: ${text.trim()}`),
  cwd: dir,
});
expect(queued === 0, `queue create exited ${queued}`);
const viewer = await startViewer({ store: db, labels, port: 0, labelledBy: 'the browser journey' });

let browser: Browser;
try {
  browser = await chromium.launch({ headless: true });
} catch (cause) {
  process.stderr.write(`Cannot start Chromium: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  await viewer.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(2);
}

try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors: string[] = [];
    const external: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => {
      if (!request.url().startsWith(viewer.url)) external.push(request.url());
    });
    const check = async (name: string) => {
      const scrollWidth = Number(await page.evaluate('document.documentElement.scrollWidth'));
      await page.screenshot({ path: join(out, `${width}-${name}.png`) });
      record.push({ width, page: name, path: page.url().slice(viewer.url.length), scrollWidth });
      expect(scrollWidth <= width, `${width} px ${name}: the page scrolls sideways (${scrollWidth} px wide)`);
    };

    await page.goto(`${viewer.url}/`);
    await check('campaigns');
    await page.click('a[href="/campaign/c-acme-x3"]');
    // The scorecard opens on its three zones; the detailed tables, the spread view among them, are folded below.
    await page.waitForSelector('#tests');
    await page.waitForSelector('#spread', { state: 'attached' });
    await check('scorecard');
    // A failing run's row opens its panel, which links to the run's own page.
    await page.locator('.run-row.r-fail a.rowlink').first().click();
    await page.waitForSelector('.drawer:target');
    await check('run-panel');
    await page.locator('.drawer:target a.open').click();
    await page.waitForSelector('#labelling');
    await check('run');

    const form = page.locator('#block-3 form');
    const criterion =
      (await form.locator('select[name=criterion] option').first().getAttribute('value')) ?? '';
    const note = `No recap before the order, labelled at ${width} px.`;
    await form.locator('select[name=criterion]').selectOption(criterion);
    await form.locator('input[value=fail]').check();
    await form.locator('input[name=note]').fill(note);
    await form.locator('button[type=submit]').click();
    await page.waitForSelector('.saved');
    await check('run-saved');
    const banner = await page.locator('.saved').innerText();
    const shown = await page.locator('#block-3 .labels ul').innerText();
    record.push({ width, criterion, banner, shown });
    expect(banner === `Label saved: ${criterion}.`, `${width} px: the saved banner reads "${banner}"`);
    expect(
      shown.includes(`${criterion}: fail. ${note}`),
      `${width} px: the label is not shown under the block`,
    );

    const loaded = await loadLabels(labels);
    const saved = (loaded.labels.get(criterion) ?? []).find((block) => block.note === note);
    record.push({ width, labelsFile: saved ? { id: saved.id, label: saved.label } : null });
    expect(saved?.label === 'fail', `${width} px: the label is not in ${criterion}.yaml`);

    await page.goto(`${viewer.url}/queue`);
    await check('queue');
    await page.locator('#queue tbody a, #queue tbody button').first().waitFor();
    await page.keyboard.press('j');
    const focusedInQueue = await page.evaluate(
      "!!document.activeElement && !!document.activeElement.closest('#queue')",
    );
    record.push({ width, keyboardFocusInQueue: focusedInQueue });
    expect(focusedInQueue === true, `${width} px: the j key does not move focus into the queue`);
    const takeRow = page.locator('#queue tbody tr', { has: page.locator('button') }).first();
    const queuedCriterion = (await takeRow.locator('td').nth(1).innerText()).trim();
    await takeRow.locator('button').click();
    await page.waitForSelector('#queue tbody tr:has-text("assigned")');
    await check('queue-taken');
    const heldBy = await page.locator('#queue tbody tr:has-text("assigned") td').nth(3).innerText();
    expect(
      heldBy.trim() === 'the browser journey',
      `${width} px: the queue shows the item held by "${heldBy}"`,
    );
    const labelLink = page.locator('#queue a', { hasText: 'Label it' }).first();
    const labelHref = (await labelLink.getAttribute('href')) ?? '';
    const queueIndex = labelHref.split('#block-')[1] ?? '';
    await page.goto(`${viewer.url}${labelHref}`);
    await page.waitForSelector(`#block-${queueIndex} form`);
    const queueForm = page.locator(`#block-${queueIndex} form`);
    await queueForm.locator('select[name=criterion]').selectOption(queuedCriterion);
    await queueForm.locator('select[name=criterion]').focus();
    await page.keyboard.press('1');
    const passChecked = await queueForm.locator('input[value=pass]').isChecked();
    expect(passChecked, `${width} px: key 1 did not check pass`);
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForSelector('.saved');
    await check('label-by-keys');
    const blockBefore = await page.evaluate(
      "document.activeElement && document.activeElement.closest('div.block') ? document.activeElement.closest('div.block').id : ''",
    );
    await page.keyboard.press('ArrowDown');
    const blockAfter = await page.evaluate(
      "document.activeElement && document.activeElement.closest('div.block') ? document.activeElement.closest('div.block').id : ''",
    );
    record.push({ width, arrows: { blockBefore, blockAfter } });
    expect(
      blockAfter !== '' && blockAfter !== blockBefore,
      `${width} px: ArrowDown did not move focus to the next block (${blockBefore} to ${blockAfter})`,
    );
    await page.keyboard.press('?');
    await page.waitForURL('**/keys');
    const cheatsheet = await page.locator('#keys').count();
    record.push({ width, cheatsheet });
    expect(cheatsheet === 1, `${width} px: the ? key did not open the cheatsheet`);
    record.push({ width, keyLabelling: { passChecked } });

    const plain = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: false });
    const plainPage = await plain.newPage();
    await plainPage.goto(`${viewer.url}${labelHref}`);
    const plainForm = plainPage.locator(`#block-${queueIndex} form`);
    await plainForm.locator('select[name=criterion]').selectOption(queuedCriterion);
    await plainForm.locator('input[value=fail]').check();
    await plainForm.locator('button[type=submit]').click();
    await plainPage.waitForSelector('.saved');
    const plainBanner = await plainPage.locator('.saved').innerText();
    record.push({ width, scriptOff: { banner: plainBanner } });
    expect(
      plainBanner.startsWith('Label saved'),
      `${width} px: the script-off form did not save: "${plainBanner}"`,
    );
    await plain.close();
    await page.goto(`${viewer.url}/queue`);
    await page.waitForSelector('#queue tbody tr:has-text("done")');
    await check('queue-done');
    const doneCount = await page.locator('#queue tbody tr:has-text("done")').count();
    record.push({ width, queuedCriterion, queueIndex, doneCount });
    expect(doneCount >= 1, `${width} px: no queue item reads done after its label was saved`);

    await page.goto(`${viewer.url}/compare`);
    await page.selectOption('select[name=baseline]', 'c-acme');
    await page.selectOption('select[name=candidate]', 'c-acme-x3');
    await page.fill('input[name=margin]', '15');
    await page.click('button[type=submit]');
    await page.waitForSelector('#compare');
    await check('compare');
    const verdict = await page.locator('.verdict-label').innerText();
    record.push({ width, verdict, consoleErrors: errors, externalRequests: external });
    expect(verdict === 'Regressed', `${width} px: the compare verdict reads "${verdict}"`);
    expect(errors.length === 0, `${width} px: console errors: ${errors.join(' | ')}`);
    expect(external.length === 0, `${width} px: requests off the viewer: ${external.join(' | ')}`);
    await page.close();
  }
} catch (cause) {
  failures.push(`the journey stopped: ${cause instanceof Error ? cause.message : String(cause)}`);
} finally {
  await browser.close();
  await viewer.close();
  await rm(dir, { recursive: true, force: true });
}

await writeFile(join(out, 'journey.json'), `${JSON.stringify({ steps: record, failures }, null, 2)}\n`);
if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`✗ ${failure}\n`);
  process.exit(1);
}
process.stdout.write(
  `Viewer journey: ${record.length} steps at 1280 and 390 px, a label saved and read back, no console error, no external request, no sideways scroll. Captures in ${out}.\n`,
);

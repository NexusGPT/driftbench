import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readmeClaims } from '../../src/ladders/system/bank/claims/report';
import { PASS, scratchFolder, systemBank } from '../../src/ladders/system/bank/index';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const REPORTS = 'examples/acme/reports';
const CLEAN = 'claim/report/acme-junit-75-pass';
const REGRESSED = 'claim/report/acme-faults-regressed';
const FLAGS = 'claim/report/acme-faults-flags';
const JUNIT = 'breaker2/report/committed-junit-consistent';
const IDS = [CLEAN, REGRESSED, FLAGS, JUNIT];
const bank = systemBank();

describe('the committed Acme report claims keep code-held signal floors', () => {
  let scratch: ReturnType<typeof scratchFolder>;

  beforeEach(() => {
    scratch = scratchFolder();
    mkdirSync(join(scratch.path, REPORTS), { recursive: true });
    for (const file of ['README.md', 'acme-faults.html', 'acme-junit.xml', 'acme-faults-junit.xml']) {
      copyFileSync(join(ROOT, REPORTS, file), join(scratch.path, REPORTS, file));
    }
  });
  afterEach(() => scratch.remove());

  function edit(file: string, before: string | RegExp, after: string) {
    const path = join(scratch.path, REPORTS, file);
    const text = readFileSync(path, 'utf8');
    const changed = text.replace(before, after);
    expect(changed, `plant in ${file} must change its input`).not.toBe(text);
    writeFileSync(path, changed);
  }

  async function check(id: string, seed = 1) {
    const item = bank.find((entry) => entry.id === id);
    expect(item, id).toBeDefined();
    if (!item) throw new Error(`missing bank item ${id}`);
    const result = await item.check({ seed, root: scratch.path, scratch: scratch.path });
    console.info(`${id} seed ${seed}: ${result.pass ? 'PASS' : `FAIL: ${result.detail}`}`);
    return result;
  }

  for (const seed of [1, 2, 3]) {
    for (const id of IDS) {
      it(`passes the committed reports: ${id}, seed ${seed}`, async () => {
        expect(await check(id, seed)).toEqual(PASS);
      });
    }
  }

  function paired(regressed: number, p: number) {
    edit(
      'README.md',
      /\d+ of \d+ paired goldens regressed and none improved, McNemar exact p = [0-9.]+,/,
      `${regressed} of 26 paired goldens regressed and none improved, McNemar exact p = ${p},`,
    );
    edit(
      'acme-faults.html',
      /Paired goldens: \d+ pass in both, \d+ regressed \(baseline passes, candidate fails\), 0 improved, 0 fail in both\./,
      `Paired goldens: ${26 - regressed} pass in both, ${regressed} regressed (baseline passes, candidate fails), 0 improved, 0 fail in both.`,
    );
    edit(
      'acme-faults.html',
      /McNemar exact on the discordant goldens: p = [0-9.]+\./,
      `McNemar exact on the discordant goldens: p = ${p}.`,
    );
    expect(readmeClaims(scratch.path)).toMatchObject({ regressed, goldens: 26, p });
  }

  for (const [regressed, p] of [
    [2, 0.5],
    [0, 1],
  ] as const) {
    it(`rejects coherent no-signal reports: ${regressed} of 26, p = ${p}`, async () => {
      paired(regressed, p);
      const result = await check(REGRESSED);
      expect(result.pass).toBe(false);
      if (result.pass) throw new Error('the no-signal plant passed');
      expect(result.detail).toContain(
        `must show at least 1 regressed golden and recomputed p below 0.001; found ${regressed} regressed, p `,
      );
      expect(Number(result.detail.split(', p ')[1])).toBeCloseTo(p, 12);
    });
  }

  it('rejects p above 0.001 even when below the product threshold of 0.05', async () => {
    paired(10, 0.002);
    expect((await check(REGRESSED)).pass).toBe(false);
  });

  it('accepts recomputed p below 0.001 even when the printed p rounds to 0.001', async () => {
    paired(11, 0.001);
    expect(await check(REGRESSED)).toEqual(PASS);
  });

  it('rejects zero flags even when the README and an empty flag table agree', async () => {
    edit('README.md', /flag on \d+ goldens\./, 'flag on 0 goldens.');
    edit('acme-faults.html', /(<caption>New gating flags[\s\S]*?<tbody>)[\s\S]*?(<\/tbody>)/, '$1\n$2');
    expect(readmeClaims(scratch.path).flagged).toBe(0);
    expect(await check(FLAGS)).toEqual({
      pass: false,
      detail: 'acme-faults.html must show at least 1 golden with a forbidden or safety flag; found 0',
    });
  });

  it('rejects zero failures even when the README and every faults JUnit count agree', async () => {
    edit('README.md', /The fault campaign fails \d+ of its/, 'The fault campaign fails 0 of its');
    edit('acme-faults-junit.xml', /failures="\d+"/g, 'failures="0"');
    edit('acme-faults-junit.xml', /<failure\b[^>]*>[\s\S]*?<\/failure>/g, '');
    expect(readmeClaims(scratch.path).faultFails).toBe(0);
    expect(await check(JUNIT)).toEqual({
      pass: false,
      detail: 'acme-faults-junit.xml must show at least 1 failure; found 0',
    });
  });

  it('rejects an empty clean JUnit even when the README agrees', async () => {
    edit('README.md', /The Acme agents pass all \d+ runs\./, 'The Acme agents pass all 0 runs.');
    writeFileSync(
      join(scratch.path, REPORTS, 'acme-junit.xml'),
      '<testsuites tests="0" failures="0" errors="0"><testsuite tests="0"/></testsuites>',
    );
    for (const id of [CLEAN, JUNIT]) {
      expect(await check(id)).toEqual({
        pass: false,
        detail: 'acme-junit.xml must show at least 1 run; found 0',
      });
    }
  });

  it('rejects an empty faults JUnit even when the README agrees', async () => {
    edit(
      'README.md',
      /The fault campaign fails \d+ of its \d+ runs\./,
      'The fault campaign fails 0 of its 0 runs.',
    );
    writeFileSync(
      join(scratch.path, REPORTS, 'acme-faults-junit.xml'),
      '<testsuites tests="0" failures="0" errors="0"><testsuite tests="0"/></testsuites>',
    );
    const result = await check(JUNIT);
    expect(result.pass).toBe(false);
    if (result.pass) throw new Error('the empty faults JUnit passed');
    expect(result.detail).toContain('acme-faults-junit.xml must show at least 1 run; found 0');
  });

  const wrongNumbers: Array<[string, string, string[]]> = [
    ['pass all 78 runs', 'pass all 77 runs', [CLEAN, JUNIT]],
    ['14 of 26', '13 of 26', [REGRESSED]],
    ['14 of 26', '14 of 25', [REGRESSED]],
    ['p = 0.0001', 'p = 0.0002', [REGRESSED]],
    ['p = 0.0001', 'p below 0.0001', [REGRESSED]],
    ['p = 0.0001', 'p = 0.9', [REGRESSED]],
    ['flag on 14 goldens', 'flag on 15 goldens', [FLAGS]],
    ['fails 42 of its 78', 'fails 41 of its 78', [JUNIT]],
    ['fails 42 of its 78', 'fails 42 of its 77', [JUNIT]],
  ];
  for (const [before, after, failed] of wrongNumbers) {
    it(`still rejects the reviewer's single wrong README number: ${after}`, async () => {
      edit('README.md', before, after);
      for (const id of IDS) {
        const result = await check(id);
        expect(result.pass, id).toBe(!failed.includes(id));
        if (!result.pass) expect(result.detail).not.toBe('');
      }
    });
  }
});

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const shots = JSON.parse(readFileSync(join(ROOT, 'docs/assets/scorecard-shots.json'), 'utf8'));
const guide = readFileSync(join(ROOT, 'docs/guide/quickstart.md'), 'utf8');
const alt = /<img src="\.\.\/assets\/scorecard-light\.png" alt="([^"]+)"/.exec(guide)?.[1] ?? '';

/** The numbers of one theme, as "label: value (note)" lines. */
function lines(theme) {
  const t = shots.themes[theme];
  return [
    ...t.stats.map((s) => `${s.label}: ${s.value} (${s.note})`),
    ...t.modes.map((m) => `${m.mode}: ${m.value}`),
  ];
}

describe('the guide pictures of the scorecard', () => {
  it('are drawn from the committed page as it is now', () => {
    const html = readFileSync(join(ROOT, shots.page));
    expect(createHash('sha256').update(html).digest('hex')).toBe(shots.sha256);
  });

  it('show the same numbers in the dark and the light picture, at the same size', () => {
    expect(lines('dark').length).toBeGreaterThan(3);
    expect(lines('light')).toEqual(lines('dark'));
    expect(shots.themes.light.height).toBe(shots.themes.dark.height);
  });

  it('show the numbers the page holds', () => {
    const html = readFileSync(join(ROOT, shots.page), 'utf8');
    for (const s of shots.themes.dark.stats) {
      const [n, of] = s.value.split(/\s*of\s*/);
      expect(html).toContain(`<p class="n">${n}<small>of ${of}</small></p>`);
    }
  });

  it('are described by the guide alt text with the same numbers', () => {
    expect(alt).not.toBe('');
    const stats = shots.themes.dark.stats;
    const value = (label) => stats.find((s) => s.label === label)?.value.replace(/\s*of\s*/, ' of ');
    expect(alt).toContain(`${value('Cases passing')} cases passing`);
    expect(alt).toContain(`${value('Runs passing')} runs passing`);
    const regressed = value('Cases regressed vs baseline');
    expect(alt).toContain(`${regressed} cases regressed`);
    const p = /McNemar p = ([\d.]+)/.exec(
      stats.find((s) => s.label === 'Cases regressed vs baseline')?.note ?? '',
    )?.[1];
    expect(alt).toContain(`McNemar p = ${p}`);
    for (const m of shots.themes.dark.modes) expect(alt).toContain(`${m.mode.toLowerCase()} ${m.value}`);
  });
});

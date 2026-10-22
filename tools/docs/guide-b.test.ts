import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runGuidePage } from './guide-page';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

describe('guide part B', () => {
  for (const page of ['run-your-agent', 'rerun-less']) {
    it(`runs docs/guide/${page}.md`, async () => {
      const problems = await runGuidePage(ROOT, `docs/guide/${page}.md`);
      expect(problems.join('\n')).toBe('');
    }, 600_000);
  }
});

import { describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

/** What `driftbench <command> --help` prints, and its exit code. */
async function helpOf(command: string): Promise<{ code: number; text: string }> {
  let text = '';
  const io: Io = {
    out: (chunk) => {
      text += chunk;
    },
    err: (chunk) => {
      text += chunk;
    },
    cwd: process.cwd(),
  };
  const code = await main([command, '--help'], io);
  return { code, text };
}

describe('the --aggregate help', () => {
  for (const command of ['report', 'ci']) {
    it(`prints a quoted example for ${command}, since a shell reads >= as a redirect`, async () => {
      const help = await helpOf(command);
      expect(help.code).toBe(0);
      expect(help.text).toContain("'pass-rate:>=0.8'");
      expect(help.text).toContain('a shell reads >= as a redirect');
    });
  }
});

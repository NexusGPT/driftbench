import { fileURLToPath } from 'node:url';
import { Command, CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';
import { acmeAdapter } from '../../core/test/runner/support';
import { type CampaignDeps, defaultDeps } from '../src/commands/campaign';
import { registerSmokeCommand } from '../src/commands/smoke';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPEC = 'examples/acme/specs/conversations/plan-upgrade.yaml';

/** Runs the CLI: through `main` with the interim build, or with the deps a test gives. */
async function cli(argv: string[], deps?: Partial<CampaignDeps>) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: ROOT,
  };
  if (!deps) return { code: await main(argv, io), out, err };
  let code = 0;
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });
  registerSmokeCommand(
    program,
    io,
    (exit) => {
      code = exit;
    },
    { ...defaultDeps, ...deps },
  );
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return { code: cause.exitCode === 0 ? 0 : 2, out, err };
    throw cause;
  }
  return { code, out, err };
}

/** The Acme agent with a reply in block 1 that changes from run to run: a nondeterministic agent. */
function drifting(deterministic: boolean) {
  const adapter = acmeAdapter({ capabilities: { deterministic } });
  const send = adapter.send.bind(adapter);
  adapter.send = async (session, turn) => {
    const observed = await send(session, turn);
    if (turn.index !== 1) return observed;
    const text = `${observed.text} (reply ${adapter.calls.open})`;
    return {
      ...observed,
      text,
      segments: [...observed.segments.filter((s) => s.type !== 'text'), { type: 'text', text }],
    };
  };
  return adapter;
}

describe('driftbench smoke', () => {
  it('runs the spec three times with the cache off and finds identical transcripts', async () => {
    const { code, out } = await cli(['smoke', SPEC, '--target', 'function:acme']);
    expect(code).toBe(0);
    expect(out).toContain('Smoke: acme-plan-upgrade on function:acme, 3 runs, cache off.');
    expect(out.match(/^ {2}run \d {2}completed {2}5 blocks {2}transcript [0-9a-f]{12}$/gm)).toHaveLength(3);
    expect(out).toContain('✓ The transcripts are identical.');
  });

  it('takes --runs', async () => {
    const two = await cli(['smoke', SPEC, '--target', 'function:acme', '--runs', '2']);
    expect(two.code).toBe(0);
    expect(two.out).toContain('2 runs, cache off');
    const one = await cli(['smoke', SPEC, '--target', 'function:acme', '--runs', '1']);
    expect(one.code).toBe(2);
    expect(one.err).toContain('--runs takes a whole number of at least 2, not "1".');
  });

  it('exits 1 and names the first differing block when the transcripts differ', async () => {
    const { code, out } = await cli(['smoke', SPEC, '--target', 'function:acme'], {
      adapterFor: async () => drifting(false),
    });
    expect(code).toBe(1);
    expect(out).toContain('✗ The transcripts differ: run 2 first differs from run 1 at block 1.');
    expect(out).toContain('The adapter does not claim to be deterministic.');
  });

  it('exits 1 and names the block that breaks the claim when the adapter claims determinism', async () => {
    const { code, out } = await cli(['smoke', SPEC, '--target', 'function:acme'], {
      adapterFor: async () => drifting(true),
    });
    expect(code).toBe(1);
    expect(out).toContain(
      'The adapter claims to be deterministic, so the difference at block 1 fails that claim.',
    );
  });

  it('prints one JSON document with --json', async () => {
    const { code, out } = await cli(['smoke', SPEC, '--target', 'function:acme', '--json'], {
      adapterFor: async () => drifting(true),
    });
    expect(code).toBe(1);
    const report = JSON.parse(out) as {
      identical: boolean;
      firstDifference: unknown;
      deterministicClaim: boolean;
    };
    expect(report).toMatchObject({
      identical: false,
      firstDifference: { run: 1, block: 1 },
      deterministicClaim: true,
    });
  });

  it('exits 2 on a folder of specs and on a target this build cannot reach', async () => {
    const folder = await cli(['smoke', 'examples/acme/specs/conversations', '--target', 'function:acme']);
    expect(folder.code).toBe(2);
    expect(folder.err).toContain('smoke takes one spec; examples/acme/specs/conversations holds 6.');
    const target = await cli(['smoke', SPEC, '--target', 'nexus:max']);
    expect(target.code).toBe(2);
    expect(target.err).toContain('No adapter is set up for nexus:max.');
  });
});

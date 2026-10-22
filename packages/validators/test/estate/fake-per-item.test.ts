import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePredicate } from '@agent-nexus/driftbench-generate';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

const FIXTURE = fileURLToPath(new URL('../../../../examples/estates/fixture/', import.meta.url));
const REGISTER = 'register.invoice-reconcile.end-with-one-line-per-invoice';
// A phrase of the bank's invoice-reconcile situation, which declares its inputs: INV-1001.
const ASK = 'Reconcile invoice INV-1001 against purchase order PO-2001.';
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** The closing reply of the stand-in agent, with a map whose register declares one line per item, in an estate copy. */
async function reply(options: { withoutRegister?: boolean }): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), 'fake-per-item-'));
  folders.push(cwd);
  cpSync(FIXTURE, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
  const map = parse(readFileSync(join(FIXTURE, 'approved.yaml'), 'utf8')) as {
    atoms: Array<{
      id: string;
      fields?: Record<string, unknown>;
      provenance: { file: string; quote: string };
    }>;
  };
  const atom = map.atoms.find((candidate) => candidate.id === REGISTER);
  if (!atom) throw new Error(`the fixture holds no ${REGISTER}`);
  atom.fields = { ...atom.fields, replyShape: 'one_line_per_item' };
  const mapPath = join(cwd, 'per-item-map.yaml');
  writeFileSync(mapPath, stringify(map));
  if (options.withoutRegister) {
    const file = join(cwd, atom.provenance.file);
    writeFileSync(file, readFileSync(file, 'utf8').replace(atom.provenance.quote, ''));
  }
  const agent = await import(join(FIXTURE, 'live/fake/agent.mjs'));
  const out = agent.planStream({
    ask: ASK,
    cwd,
    sessionId: 'test',
    env: { ...process.env, FAKE_MAP: mapPath, FAKE_PHRASES: join(FIXTURE, 'phrases.yaml') },
  });
  const texts = (
    out.records as Array<{ message?: { content?: Array<{ type?: string; text?: string }> } }>
  ).flatMap((record) =>
    (record.message?.content ?? []).filter((item) => item.type === 'text').map((item) => item.text ?? ''),
  );
  return texts.at(-1) ?? '';
}

/** Whether a reply passes the check the generator compiles from the situation's inputs. */
function keeps(text: string): boolean {
  const compiled = compilePredicate('one_line_per_item', { items: ['INV-1001'] });
  if (!compiled) throw new Error('not compiled');
  const found = (source: string) => new RegExp(source, 'mi').test(text);
  return (compiled.must ?? []).every(found) && !(compiled.mustNot ?? []).some(found);
}

describe('the stand-in agent ends its reply with one line per input item while the register is in force', () => {
  it('ends with a line for INV-1001 when the register that declares one_line_per_item is in force', async () => {
    const text = await reply({});
    expect(text.split('\n').at(-1)).toContain('INV-1001');
    expect(keeps(text)).toBe(true);
  });

  it('gives its plain reply, which the compiled check fails, when that register is gone from the copy', async () => {
    const text = await reply({ withoutRegister: true });
    expect(text).not.toContain('INV-1001');
    expect(keeps(text)).toBe(false);
  });
});

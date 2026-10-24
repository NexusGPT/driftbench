import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

const FIXTURE = fileURLToPath(new URL('../../../../examples/estates/fixture/', import.meta.url));
const REGISTER = 'register.ledger-auditor.answer-with-one-json-object-and';
const ASK =
  'Audit ledger/2026-W41.csv for double payments and unapplied credit notes. Answer with one JSON object.';
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** The closing reply of the stand-in agent, with a map whose register declares the shape, in an estate copy. */
async function reply(options: {
  withoutRegister?: boolean;
  ask?: string;
  register?: string;
  without?: string;
  /** Replaces the `ordered` evidence of the gate atom of that id. */
  ordering?: { gate: string; before: string; after: string };
}): Promise<string> {
  const cwd = mkdtempSync(join(tmpdir(), 'fake-shape-'));
  folders.push(cwd);
  cpSync(FIXTURE, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
  const map = parse(readFileSync(join(FIXTURE, 'approved.yaml'), 'utf8')) as {
    atoms: Array<{
      id: string;
      fields?: Record<string, unknown>;
      provenance: { file: string; quote: string };
    }>;
  };
  const atom = map.atoms.find((candidate) => candidate.id === (options.register ?? REGISTER));
  if (!atom) throw new Error(`the fixture holds no ${options.register ?? REGISTER}`);
  atom.fields = { ...atom.fields, replyShape: 'json_only' };
  if (options.ordering) {
    const gate = map.atoms.find((candidate) => candidate.id === options.ordering?.gate) as
      | { evidence: Array<Record<string, unknown>> }
      | undefined;
    if (!gate) throw new Error(`the fixture holds no ${options.ordering.gate}`);
    // A gate that names no file and no first call has no read to put first: the ordering cannot be resolved.
    const fields = { ...(gate as { fields?: Record<string, unknown> }).fields };
    delete fields.first;
    delete fields.path;
    delete fields.order;
    (gate as { fields?: Record<string, unknown> }).fields = fields;
    gate.evidence = gate.evidence.map((item) =>
      item.type === 'ordered'
        ? { type: 'ordered', before: options.ordering?.before, after: options.ordering?.after }
        : item,
    );
  }
  const mapPath = join(cwd, 'shape-map.yaml');
  writeFileSync(mapPath, stringify(map));
  if (options.without) rmSync(join(cwd, options.without));
  if (options.withoutRegister) {
    const file = join(cwd, atom.provenance.file);
    writeFileSync(file, readFileSync(file, 'utf8').replace(atom.provenance.quote, ''));
  }
  const agent = await import(join(FIXTURE, 'live/fake/agent.mjs'));
  const out = agent.planStream({
    ask: options.ask ?? ASK,
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

describe('the stand-in agent answers in the shape a reply rule in force declares', () => {
  it('answers one JSON object when the register that declares json_only is in force', async () => {
    const text = await reply({});
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('answers in prose when that register is gone from the estate copy', async () => {
    const text = await reply({ withoutRegister: true });
    expect(() => JSON.parse(text)).toThrow();
  });

  it('answers one JSON error object when a prerequisite read fails while that register is in force', async () => {
    const text = await reply({
      ask: 'Reconcile invoice INV-1001 against purchase order PO-2001.',
      register: 'register.invoice-reconcile.end-with-one-line-per-invoice',
      without: '.claude/skills/invoice-reconcile/references/matching-rules.md',
    });
    const parsed = JSON.parse(text) as { status?: string };
    expect(parsed.status).toBe('error');
  });

  it('keeps the prose failure reply when no register fixes a shape', async () => {
    const text = await reply({
      ask: 'Reconcile invoice INV-1001 against purchase order PO-2001.',
      without: '.claude/skills/invoice-reconcile/references/matching-rules.md',
    });
    // The invoice-reconcile register of the fixture asks one line per invoice: the failure reply keeps its prose and ends with that line.
    expect(text.split('\n')[0]).toBe('An action could not complete; I stopped before continuing.');
  });

  it('answers one JSON error object when an ordering obligation cannot be resolved while that register is in force', async () => {
    const text = await reply({
      ask: 'Reconcile invoice INV-1001 against purchase order PO-2001.',
      register: 'register.invoice-reconcile.end-with-one-line-per-invoice',
      ordering: {
        gate: 'gate.invoice-reconcile.read-references-matching-rules-md-before',
        before: 'Bash',
        after: 'Read',
      },
    });
    const parsed = JSON.parse(text) as { status?: string; message?: string };
    expect(parsed.status).toBe('error');
    expect(parsed.message).toContain('ordering obligation');
  });

  it('keeps the prose ordering error when no register fixes a shape', async () => {
    const text = await reply({
      ask: 'Reconcile invoice INV-1001 against purchase order PO-2001.',
      ordering: {
        gate: 'gate.invoice-reconcile.read-references-matching-rules-md-before',
        before: 'Bash',
        after: 'Read',
      },
    });
    expect(text.split('\n')[0]).toBe(
      'The skill has an ordering obligation whose actions cannot be resolved.',
    );
  });
});

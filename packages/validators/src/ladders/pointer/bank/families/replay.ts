import { distinctSentences } from '../../kit/anchor-world';
import { runChild } from '../../kit/child-run';
import { compose } from '../../kit/compose';
import { loadFixture, perturb } from '../../kit/fixture';
import { show } from '../../kit/oracle';
import { requireSourceWitness } from '../../kit/positive';
import { PROBE_YAML, RULES_YAML, TWO_SETS_YAML } from '../../kit/sets';
import { type FakeTransport, fakeTransport } from '../../kit/transport';
import { headingText, Prose, rewordWords } from '../../kit/words';
import type { FetchRequest, ModelArm, ScanRequest, ScanResult, SourceFile } from '../../sut/port';
import { fail, type ItemContext, type Outcome, pass, type Run } from '../types';

const prose = (ctx: ItemContext) => new Prose(ctx.seed, ctx.id);
const para = (text: string) => ({ kind: 'paragraph' as const, sentences: [text] });

function threeFiles(ctx: ItemContext, tokens = false): { files: SourceFile[]; texts: string[][] } {
  const p = prose(ctx);
  const texts = [0, 1, 2].map((f) =>
    distinctSentences(p, 6).map((t, i) => (tokens ? t.replace(/\.$/, ` ZQ7-${f}${i}-NOTE.`) : t)),
  );
  const files = texts.map((ts, f) => ({
    path: `notes/${['a', 'b', 'c'][f]}.md`,
    text: compose([{ kind: 'heading', level: 1, text: headingText(p.random) }, ...ts.map(para)]).text,
  }));
  return { files, texts };
}

const closed = (): FakeTransport => fakeTransport({ respond: () => ({ status: 500, body: 'closed' }) });

async function record(
  files: SourceFile[],
  arm: ModelArm,
  fake: FakeTransport,
  extra: Partial<ScanRequest> = {},
  ctx?: ItemContext,
): Promise<ScanResult> {
  const result = await (ctx as ItemContext).sut.scan({
    files,
    model: { arm, transport: fake },
    ...extra,
    cassette: { mode: 'record' },
  });
  requireSourceWitness(result, files);
  if (fake.count === 0 || !result.cassette?.trim())
    throw new Error('positive witness: recording produced no request or cassette entry');
  return result;
}

async function replay(
  ctx: ItemContext,
  files: SourceFile[],
  arm: ModelArm,
  cassette: string,
  extra: Partial<ScanRequest> = {},
  threshold?: number,
): Promise<{ res: ScanResult; fake: FakeTransport }> {
  const fake = closed();
  const res = await ctx.sut.scan({
    files,
    model: { arm, transport: fake, ...(threshold !== undefined ? { threshold } : {}) },
    cassette: { mode: 'replay', text: cassette },
    ...extra,
  });
  if (res.ok) requireSourceWitness(res, files);
  return { res, fake };
}

const must = (res: ScanResult, what: string): string => {
  if (!res.ok || !res.ledger) throw new Error(`${what}: ${res.error ?? 'no ledger'}`);
  return res.ledger.raw;
};

const lines = (cassette: string) => cassette.split('\n').filter((l) => l.trim() !== '');

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

function keysOf(v: unknown, out: Map<string, unknown> = new Map(), prefix = ''): Map<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) {
      out.set(`${prefix}${k}`.toLowerCase().replace(/[^a-z0-9.]/g, ''), x);
      keysOf(x, out, `${prefix}${k}.`);
    }
  }
  return out;
}

const mentions = (error: string | undefined, names: string[]): boolean => {
  const e = (error ?? '').toLowerCase();
  return names.some((n) => e.includes(n.toLowerCase()));
};

async function missCase(
  ctx: ItemContext,
  edit: (files: SourceFile[], texts: string[][], yaml: string) => { files: SourceFile[]; yaml: string },
  names: string[],
  arm: ModelArm = 'haiku',
): Promise<Outcome> {
  const { files, texts } = threeFiles(ctx);
  const recorded = await record(files, arm, fakeTransport(), { labelsYaml: TWO_SETS_YAML }, ctx);
  must(recorded, 'record');
  const changed = edit(files, texts, TWO_SETS_YAML);
  const { res, fake } = await replay(ctx, changed.files, arm, recorded.cassette ?? '', {
    labelsYaml: changed.yaml,
  });
  if (res.ok) return fail('a changed request was served from the cassette: no miss');
  if (fake.count !== 0) return fail(`the miss reached the network (${fake.count} calls)`);
  return mentions(res.error, names)
    ? pass(`the miss names ${names.find((n) => (res.error ?? '').toLowerCase().includes(n.toLowerCase()))}`)
    : fail(`the miss does not name any of ${names.join(', ')}: ${res.error}`);
}

/** Replays the committed cassette on the fixture estate; every label found must belong to the default set. */
async function fixtureReplay(
  ctx: ItemContext,
  arm: ModelArm,
  cassetteOf?: (cassette: string) => string,
): Promise<{ res?: ScanResult; fake?: FakeTransport; why?: string }> {
  const fixture = loadFixture(arm);
  if ('why' in fixture) return { why: fixture.why };
  const fake = closed();
  const res = await ctx.sut.scan({
    files: fixture.files,
    model: { arm, transport: fake },
    cassette: { mode: 'replay', text: cassetteOf ? cassetteOf(fixture.cassette) : fixture.cassette },
  });
  return { res, fake };
}

const fixtureReplaysCase =
  (arm: ModelArm): Run =>
  async (ctx) => {
    const r = await fixtureReplay(ctx, arm);
    if (!r.res || !r.fake) return fail(r.why ?? 'no fixture');
    if (!r.res.ok || !r.res.ledger)
      return fail(`the committed cassette did not replay: ${r.res.error ?? 'no ledger'}`);
    if (r.fake.count !== 0) return fail(`replay called the transport ${r.fake.count} times`);
    const labelled = r.res.ledger.entries.filter(
      (e) => e.status === 'live' && Object.keys(e.labels).length > 0,
    );
    if (labelled.length === 0) return fail('no entry holds a label after the replay');
    return pass(`${labelled.length} labelled entries, no network`);
  };

const fixtureMissCase =
  (arm: ModelArm, field: string, value: string, names: string[], extra: string[] = []): Run =>
  async (ctx) => {
    const fixture = loadFixture(arm);
    if ('why' in fixture) return fail(fixture.why);
    const made = perturb(fixture, arm, ctx.seed, field, value);
    const fake = closed();
    const res = await ctx.sut.scan({
      files: fixture.files,
      model: { arm, transport: fake },
      cassette: { mode: 'replay', text: made.cassette },
    });
    if (res.ok) return fail('a request whose recorded entry was changed was served from the cassette');
    if (fake.count !== 0) return fail(`the miss reached the network (${fake.count} calls)`);
    if (!mentions(res.error, names))
      return fail(`the miss does not name any of ${names.join(', ')}: ${res.error}`);
    for (const e of extra)
      if (!(res.error ?? '').includes(e)) return fail(`the message does not hold ${e}: ${res.error}`);
    return pass(`the miss names ${names[0]}`);
  };

export const replayRuns: Record<string, Run> = {
  'fixture-haiku-replays-committed': fixtureReplaysCase('haiku'),
  'fixture-jev-replays-committed': fixtureReplaysCase('jev'),
  'fixture-jev-unit-replays-committed': fixtureReplaysCase('jev-unit'),
  'fixture-replay-twice-identical': async (ctx) => {
    const a = await fixtureReplay(ctx, 'haiku');
    if (!a.res?.ok || !a.res.ledger) return fail(a.why ?? `the first replay failed: ${a.res?.error}`);
    const fixture = loadFixture('haiku');
    if ('why' in fixture) return fail(fixture.why);
    const second = await ctx.sut.scan({
      files: fixture.files,
      previousLedger: a.res.ledger.raw,
      model: { arm: 'haiku', transport: closed() },
      cassette: { mode: 'replay', text: fixture.cassette },
    });
    if (!second.ok || !second.ledger) return fail(`the second replay failed: ${second.error}`);
    return second.ledger.raw === a.res.ledger.raw
      ? pass('same ledger')
      : fail('the second replay changed the ledger');
  },
  'fixture-miss-names-model': fixtureMissCase('haiku', 'model', 'claude-haiku-4-0', ['model']),
  'fixture-miss-names-prompt-version': fixtureMissCase('haiku', 'promptVersion', 'p0', [
    'promptVersion',
    'prompt version',
  ]),
  'fixture-miss-names-schema-version': fixtureMissCase('haiku', 'schemaVersion', 's0', [
    'schemaVersion',
    'schema version',
  ]),
  'fixture-miss-names-set-hash': fixtureMissCase('haiku', 'setHash', '0000000000000000', [
    'setHash',
    'set hash',
  ]),
  'fixture-miss-names-labeler': fixtureMissCase('haiku', 'labeler', 'jev', ['labeler']),
  'fixture-miss-names-system-part': fixtureMissCase('haiku', 'part.system', '000000000000', [
    'part.system',
    'system',
  ]),
  'fixture-miss-names-questions-part': fixtureMissCase('jev-unit', 'part.questions', '000000000000', [
    'part.questions',
    'questions',
  ]),
  'fixture-miss-names-cut-digest': fixtureMissCase(
    'haiku',
    'cutDigest',
    '0'.repeat(64),
    ['cutDigest', 'cut digest'],
    [process.versions.node, process.versions.icu ?? ''],
  ),
  'record-then-replay-identical': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), { labelsYaml: TWO_SETS_YAML }, ctx);
    const ledger = must(rec, 'record');
    const { res, fake } = await replay(ctx, files, 'haiku', rec.cassette ?? '', {
      labelsYaml: TWO_SETS_YAML,
    });
    if (!res.ok) return fail(`the replay failed: ${res.error}`);
    if (fake.count !== 0) return fail(`${fake.count} transport calls in the replay`);
    if (res.ledger?.raw !== ledger) return fail('the replay ledger differs from the recording run');
    return JSON.stringify(res.atoms) === JSON.stringify(rec.atoms)
      ? pass('ledger and atoms equal')
      : fail('the replay atoms differ from the recording run');
  },
  'replay-twice-identical': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), {}, ctx);
    must(rec, 'record');
    const a = await replay(ctx, files, 'haiku', rec.cassette ?? '');
    const b = await replay(ctx, files, 'haiku', rec.cassette ?? '');
    return a.res.ok &&
      b.res.ok &&
      a.res.ledger?.raw === b.res.ledger?.raw &&
      JSON.stringify(a.res.atoms) === JSON.stringify(b.res.atoms)
      ? pass('equal')
      : fail('two replays differ');
  },
  'two-recordings-same-cassette': async (ctx) => {
    const { files } = threeFiles(ctx);
    const a = await record(files, 'haiku', fakeTransport(), { labelsYaml: TWO_SETS_YAML }, ctx);
    const b = await record(files, 'haiku', fakeTransport(), { labelsYaml: TWO_SETS_YAML }, ctx);
    must(a, 'record');
    must(b, 'record');
    return a.cassette && a.cassette === b.cassette
      ? pass('byte-identical')
      : fail('two independent recordings dump different cassettes');
  },
  'miss-fails-without-network': async (ctx) => {
    const { files } = threeFiles(ctx);
    // A reader that always fails must first demonstrate a successful recording.
    await record(files, 'haiku', fakeTransport(), {}, ctx);
    const { res, fake } = await replay(ctx, files, 'haiku', '');
    if (res.ok) return fail('a replay with an empty cassette succeeded');
    return fake.count === 0 ? pass('failed, no call') : fail(`${fake.count} transport calls on a miss`);
  },
  'record-is-explicit': async (ctx) => {
    const { files } = threeFiles(ctx);
    const off = await replay(ctx, files, 'haiku', '');
    if (off.fake.count !== 0) return fail('the transport was called without record mode');
    const fake = fakeTransport();
    const rec = await record(files, 'haiku', fake, {}, ctx);
    must(rec, 'record');
    if (fake.count !== 3) return fail(`${fake.count} calls recording 3 windows, expected 3`);
    const again = fakeTransport();
    const second = await ctx.sut.scan({
      files,
      model: { arm: 'haiku', transport: again },
      cassette: { mode: 'record', text: rec.cassette },
    });
    must(second, 'second record');
    return again.count === 0
      ? pass('0, 3, 0 calls')
      : fail(`${again.count} calls recording over a finished cassette, expected 0`);
  },
  'miss-names-description-edit': (ctx) =>
    missCase(
      ctx,
      (f, _t, yaml) => ({
        files: f,
        yaml: yaml.replace(
          'A unit that tells the reader what to do.',
          'A unit that tells the reader what to do now.',
        ),
      }),
      ['setHash', 'part.user'],
    ),
  'miss-names-renamed-label': (ctx) =>
    missCase(
      ctx,
      (f, _t, yaml) => ({ files: f, yaml: yaml.replaceAll('name: description', 'name: summary') }),
      ['setHash', 'part.output', 'part.user'],
    ),
  'miss-names-added-example': (ctx) =>
    missCase(
      ctx,
      (f, _t, yaml) => ({
        files: f,
        yaml: yaml.replace(
          '        description: A unit that tells the reader what never to do.\n',
          '        description: A unit that tells the reader what never to do.\n        examples:\n          - "Never do this."\n',
        ),
      }),
      ['setHash', 'part.user'],
    ),
  'miss-names-changed-unit': (ctx) =>
    missCase(
      ctx,
      (f, t, yaml) => {
        const p = prose(ctx);
        const edited = f.map((file, i) =>
          i === 1
            ? {
                ...file,
                text: file.text.replace(t[1]?.[2] as string, rewordWords(p.random, t[1]?.[2] as string, 1)),
              }
            : file,
        );
        return { files: edited, yaml };
      },
      ['part.user'],
    ),
  'miss-names-new-file': (ctx) =>
    missCase(
      ctx,
      (f, _t, yaml) => ({
        files: [...f, { path: 'notes/d.md', text: compose([para(prose(ctx).next())]).text }],
        yaml,
      }),
      ['part.user', 'file', 'path', 'window'],
    ),
  'miss-names-cut-digest': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), {}, ctx);
    must(rec, 'record');
    const tampered = lines(rec.cassette ?? '')
      .map((l) => {
        const o = JSON.parse(l) as Record<string, unknown>;
        const walk = (v: unknown): void => {
          if (v && typeof v === 'object') {
            for (const k of Object.keys(v)) {
              if (/cutdigest/i.test(k)) (v as Record<string, unknown>)[k] = 'tampered-digest';
              else walk((v as Record<string, unknown>)[k]);
            }
          }
        };
        walk(o);
        return JSON.stringify(o);
      })
      .join('\n');
    const { res, fake } = await replay(ctx, files, 'haiku', `${tampered}\n`);
    if (res.ok) return fail('a tampered cut digest was accepted');
    if (fake.count !== 0) return fail('the miss reached the network');
    return mentions(res.error, ['cutDigest', 'cut digest'])
      ? pass('the cut digest is named')
      : fail(`the error does not name the cut digest: ${res.error}`);
  },
  'miss-names-labeler': async (ctx) => {
    const { files } = threeFiles(ctx);
    const h = await record(files, 'haiku', fakeTransport(), { labelsYaml: PROBE_YAML }, ctx);
    const j = await record(files, 'jev', fakeTransport(), { labelsYaml: PROBE_YAML }, ctx);
    must(h, 'haiku record');
    must(j, 'jev record');
    for (const [arm, cassette, other] of [
      ['jev', h.cassette, 'haiku'],
      ['haiku', j.cassette, 'jev'],
    ] as const) {
      const { res } = await replay(ctx, files, arm, cassette ?? '', { labelsYaml: PROBE_YAML });
      if (res.ok) return fail(`the ${arm} arm replayed a ${other} cassette`);
      if (!mentions(res.error, ['labeler', 'labeller', 'model', 'arm']))
        return fail(`the error does not name the labeller field: ${res.error}`);
    }
    return pass("each arm refuses the other's cassette by name");
  },
  'miss-names-set-name': (ctx) =>
    missCase(
      ctx,
      (f, _t, yaml) => ({ files: f, yaml: yaml.replace('set: house-voice', 'set: house-tone') }),
      ['setName', 'set'],
    ),
  'miss-names-nearest-entry': async (ctx) => {
    const { files, texts } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), {}, ctx);
    must(rec, 'record');
    const p = prose(ctx);
    const edited = files.map((f, i) =>
      i === 1
        ? {
            ...f,
            text: f.text.replace(texts[1]?.[2] as string, rewordWords(p.random, texts[1]?.[2] as string, 1)),
          }
        : f,
    );
    const { res } = await replay(ctx, edited, 'haiku', rec.cassette ?? '');
    if (res.ok) return fail('no miss');
    const windows = lines(rec.cassette ?? '').flatMap((l) =>
      strings(JSON.parse(l)).filter((s) => /#\d+$/.test(s)),
    );
    return windows.some((w) => (res.error ?? '').includes(w))
      ? pass('the nearest entry is named')
      : fail(`the error names no recorded window (${windows.slice(0, 3).join(', ')}): ${res.error}`);
  },
  'cut-digest-mismatch-names-versions': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), {}, ctx);
    must(rec, 'record');
    const tampered = (rec.cassette ?? '').replace(
      /("[A-Za-z]*[cC]ut[dD]igest"\s*:\s*")[^"]*(")/g,
      '$1tampered$2',
    );
    const { res } = await replay(ctx, files, 'haiku', tampered);
    if (res.ok) return fail('a tampered cut digest was accepted');
    const e = res.error ?? '';
    return e.includes(process.versions.node) && e.includes(String(process.versions.icu))
      ? pass('Node and ICU versions named')
      : fail(
          `the error lacks the Node (${process.versions.node}) and ICU (${process.versions.icu}) versions: ${e}`,
        );
  },
  'key-is-sha256-hex': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), { labelsYaml: TWO_SETS_YAML }, ctx);
    must(rec, 'record');
    const keys = lines(rec.cassette ?? '').map((l) => (JSON.parse(l) as { key?: string }).key);
    if (keys.length === 0) return fail('the cassette holds no entry');
    if (keys.some((k) => typeof k !== 'string' || !/^[0-9a-f]{64}$/.test(k)))
      return fail(
        `a key is not 64 hex characters: ${JSON.stringify(keys.find((k) => !/^[0-9a-f]{64}$/.test(String(k))))}`,
      );
    return new Set(keys).size === keys.length ? pass(`${keys.length} keys`) : fail('two entries share a key');
  },
  'key-ignores-threshold': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'jev', fakeTransport(), { labelsYaml: PROBE_YAML }, ctx);
    must(rec, 'record');
    const { res, fake } = await replay(
      ctx,
      files,
      'jev',
      rec.cassette ?? '',
      { labelsYaml: PROBE_YAML },
      0.9,
    );
    return res.ok && fake.count === 0 ? pass('no miss') : fail(`a threshold change missed: ${res.error}`);
  },
  'key-ignores-clone-path': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(
      files,
      'haiku',
      fakeTransport(),
      { location: { parent: 'alpha-one', name: 'estate' } },
      ctx,
    );
    const ledger = must(rec, 'record');
    const { res } = await replay(ctx, files, 'haiku', rec.cassette ?? '', {
      location: { parent: 'beta-two', name: 'clone' },
    });
    return res.ok && res.ledger?.raw === ledger
      ? pass('same ledger from another folder')
      : fail(`the replay from another folder failed or differs: ${res.error}`);
  },
  'key-ignores-yaml-formatting': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), { labelsYaml: RULES_YAML }, ctx);
    must(rec, 'record');
    const reformatted = `# reformatted\nlabels:\n    - description: "What an instruction file asks of the agent."\n      set: agent-rules\n      labels:\n${RULES_YAML.split(
      '\n',
    )
      .slice(4)
      .map((l) => `  ${l}`)
      .join('\n')}`;
    const { res, fake } = await replay(ctx, files, 'haiku', rec.cassette ?? '', { labelsYaml: reformatted });
    return res.ok && fake.count === 0
      ? pass('no miss')
      : fail(`a formatting-only change missed: ${res.error}`);
  },
  'cassette-no-file-text': async (ctx) => {
    const { files, texts } = threeFiles(ctx, true);
    const rec = await record(files, 'haiku', fakeTransport(), {}, ctx);
    must(rec, 'record');
    const cassette = rec.cassette ?? '';
    const leaked = texts.flat().find((t) => cassette.includes(/ZQ7-\d+-NOTE/.exec(t)?.[0] ?? '\u0000'));
    return leaked
      ? fail(`unit text reached the cassette: ${show(leaked, 50)}`)
      : pass('no unit token in the cassette');
  },
  'cassette-readable-fields': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), { labelsYaml: RULES_YAML }, ctx);
    must(rec, 'record');
    const want: Array<[string, string[]]> = [
      ['file', ['file', 'path']],
      ['window', ['window']],
      ['prompt version', ['promptversion', 'prompt']],
      ['schema version', ['schemaversion', 'schema']],
      ['set name', ['setname', 'set']],
      ['set hash', ['sethash']],
      ['labeler', ['labeler', 'labeller', 'model']],
      ['cut digest', ['cutdigest']],
    ];
    for (const l of lines(rec.cassette ?? '')) {
      const flat = keysOf(JSON.parse(l));
      for (const [name, aliases] of want) {
        const hit = [...flat].find(
          ([k, v]) =>
            aliases.some((a) => k === a || k.endsWith(`.${a}`)) && typeof v === 'string' && v !== '',
        );
        if (!hit) return fail(`an entry has no readable ${name} (looked for ${aliases.join(', ')})`);
      }
    }
    return pass('every entry readable');
  },
  'cassette-stored-answer': async (ctx) => {
    const { files } = threeFiles(ctx);
    for (const arm of ['haiku', 'jev'] as const) {
      const rec = await record(files, arm, fakeTransport(), { labelsYaml: PROBE_YAML }, ctx);
      must(rec, `${arm} record`);
      for (const l of lines(rec.cassette ?? '')) {
        const flat = [...keysOf(JSON.parse(l)).keys()];
        const has = (alias: string) => flat.some((k) => k.includes(alias));
        const need = arm === 'haiku' ? ['labels'] : ['probabilit'];
        for (const n of [...need, 'model', 'stop', 'usage'])
          if (!has(n)) return fail(`a ${arm} entry stores no ${n}`);
      }
    }
    return pass('labels or probabilities, model, stop reason and usage stored');
  },
  'model-mismatch-warns': async (ctx) => {
    const { files } = threeFiles(ctx);
    const one = await record(files, 'haiku', fakeTransport({ model: 'm-1' }), {}, ctx);
    must(one, 'first record');
    const cut = `${lines(one.cassette ?? '')
      .slice(1)
      .join('\n')}\n`;
    const two = await ctx.sut.scan({
      files,
      model: { arm: 'haiku', transport: fakeTransport({ model: 'm-2' }) },
      cassette: { mode: 'record', text: cut },
    });
    if (!two.ok) return fail(`the re-record failed: ${two.error}`);
    const w = two.warnings.find((x) => x.includes('m-1') && x.includes('m-2'));
    return w
      ? pass('a warning names both models')
      : fail(`no warning names both model ids; warnings: ${JSON.stringify(two.warnings)}`);
  },
  'carry-forward-needs-only-dirty-entries': async (ctx) => {
    const { files, texts } = threeFiles(ctx);
    const p = prose(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), {}, ctx);
    const l1 = must(rec, 'record');
    const edited = files.map((f, i) =>
      i === 1
        ? {
            ...f,
            text: f.text.replace(texts[1]?.[2] as string, rewordWords(p.random, texts[1]?.[2] as string, 1)),
          }
        : f,
    );
    const two = await ctx.sut.scan({
      files: edited,
      previousLedger: l1,
      model: { arm: 'haiku', transport: fakeTransport() },
      cassette: { mode: 'record', text: rec.cassette },
    });
    must(two, 'rescan record');
    const before = new Set(lines(rec.cassette ?? ''));
    const added = lines(two.cassette ?? '').filter((l) => !before.has(l));
    if (added.length !== 1)
      return fail(`${added.length} entries were added for one dirty window, expected 1`);
    const { res, fake } = await replay(ctx, edited, 'haiku', `${added.join('\n')}\n`, { previousLedger: l1 });
    return res.ok && fake.count === 0
      ? pass('the dirty entry alone is enough')
      : fail(`the replay needs more than the dirty entry: ${res.error}`);
  },
  'fresh-replay-needs-all-entries': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), {}, ctx);
    must(rec, 'record');
    const cut = `${lines(rec.cassette ?? '')
      .slice(1)
      .join('\n')}\n`;
    const { res } = await replay(ctx, files, 'haiku', cut);
    if (res.ok) return fail('a fresh replay succeeded with one window missing');
    return /#\d+|window/i.test(res.error ?? '')
      ? pass('the missing window is named')
      : fail(`the error names no window: ${res.error}`);
  },
  'failed-recording-keeps-valid-cassette': async (ctx) => {
    const { files } = threeFiles(ctx);
    let n = 0;
    const base = fakeTransport();
    const flaky = ((r: FetchRequest) => {
      n += 1;
      if (n === 2) throw new Error('network down');
      return base(r);
    }) as FakeTransport;
    const failedRun = await ctx.sut.scan({
      files,
      model: { arm: 'haiku', transport: flaky },
      cassette: { mode: 'record' },
    });
    if (failedRun.ok) return fail('a transport failure did not fail the scan');
    const text = failedRun.cassette ?? '';
    const entries = lines(text);
    if (entries.length !== 1)
      return fail(`the cassette of the failed run holds ${entries.length} entries, expected 1`);
    try {
      for (const l of entries) JSON.parse(l);
    } catch {
      return fail('the cassette of the failed run is not valid JSON lines');
    }
    const fake = fakeTransport();
    const again = await ctx.sut.scan({
      files,
      model: { arm: 'haiku', transport: fake },
      cassette: { mode: 'record', text },
    });
    if (!again.ok) return fail(`the second record run failed: ${again.error}`);
    return fake.count === 2
      ? pass('one entry kept, two calls to finish')
      : fail(`${fake.count} calls to finish a 3 window recording with 1 entry, expected 2`);
  },
  'answers-frozen-despite-random-transport': async (ctx) => {
    const { files } = threeFiles(ctx);
    const names = ['rule', 'prohibition', 'example', 'description'];
    let k = ctx.seed;
    const wild = fakeTransport({
      truth: () => {
        k = (k * 1103515245 + 12345) >>> 0;
        return names[k % 4] as string;
      },
    });
    const rec = await record(files, 'haiku', wild, {}, ctx);
    const ledger = must(rec, 'record');
    for (let i = 0; i < 2; i += 1) {
      const { res } = await replay(ctx, files, 'haiku', rec.cassette ?? '');
      if (!res.ok || res.ledger?.raw !== ledger) return fail(`replay ${i + 1} differs from the recording`);
    }
    return pass('two replays equal the recording');
  },
  'jsonl-format': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), {}, ctx);
    must(rec, 'record');
    const text = rec.cassette ?? '';
    if (!text.endsWith('\n')) return fail('the cassette does not end with a newline');
    if (
      text
        .split('\n')
        .slice(0, -1)
        .some((l) => l.trim() === '')
    )
      return fail('the cassette holds a blank line');
    for (const l of lines(text)) {
      const v = JSON.parse(l);
      if (v === null || typeof v !== 'object' || Array.isArray(v)) return fail('a line is not a JSON object');
    }
    return pass(`${lines(text).length} lines`);
  },
  'one-cassette-per-arm': async (ctx) => {
    const { files } = threeFiles(ctx);
    const h = await record(files, 'haiku', fakeTransport(), { labelsYaml: PROBE_YAML }, ctx);
    const j = await record(files, 'jev-unit', fakeTransport(), { labelsYaml: PROBE_YAML }, ctx);
    must(h, 'haiku');
    must(j, 'jev-unit');
    const own = await replay(ctx, files, 'jev-unit', j.cassette ?? '', { labelsYaml: PROBE_YAML });
    if (!own.res.ok) return fail(`the jev-unit arm cannot replay its own cassette: ${own.res.error}`);
    const cross = await replay(ctx, files, 'jev-unit', h.cassette ?? '', { labelsYaml: PROBE_YAML });
    if (cross.res.ok) return fail('the jev-unit arm replayed a haiku cassette');
    return mentions(cross.res.error, ['labeler', 'labeller', 'model', 'arm'])
      ? pass('own cassette replays, the other fails by name')
      : fail(`the error does not name the labeller: ${cross.res.error}`);
  },
  'replay-env-independent': async (ctx) => {
    const { files } = threeFiles(ctx);
    const rec = await record(files, 'haiku', fakeTransport(), {}, ctx);
    const ledger = must(rec, 'record');
    const envs: Array<{ env: Record<string, string>; cwdName: string }> = [
      { env: { TZ: 'UTC', LANG: 'en_US.UTF-8' }, cwdName: 'one' },
      { env: { TZ: 'Asia/Kolkata', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' }, cwdName: 'two' },
      { env: { TZ: 'America/Sao_Paulo', LANG: 'C' }, cwdName: 'three' },
    ];
    for (const e of envs) {
      const out = await runChild(
        { kind: 'scan', files, model: { arm: 'haiku' }, cassette: { mode: 'replay', text: rec.cassette } },
        e,
      );
      try {
        const r = out.output?.ok ? (out.output.result as ScanResult) : undefined;
        if (!r?.ok)
          return fail(
            `a child replay failed: ${out.output && !out.output.ok ? out.output.error : (r?.error ?? out.stderr.slice(0, 200))}`,
          );
        requireSourceWitness(r, files);
        if (r.ledger?.raw !== ledger)
          return fail(`the replay under ${JSON.stringify(e.env)} differs from the recording`);
      } finally {
        out.cleanup();
      }
    }
    return pass('three environments, one ledger');
  },
};

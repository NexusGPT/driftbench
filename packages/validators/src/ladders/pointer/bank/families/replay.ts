import { distinctSentences } from '../../kit/anchor-world';
import { runChild } from '../../kit/child-run';
import { compose } from '../../kit/compose';
import {
  type Fixture,
  loadFixture,
  makeFixture,
  perturb,
  RUNS,
  requireFixtureLabels,
} from '../../kit/fixture';
import { show } from '../../kit/oracle';
import { requireSourceWitness } from '../../kit/positive';
import { PROBE_YAML, RULES_YAML, TWO_SETS_YAML } from '../../kit/sets';
import { type FakeTransport, fakeTransport, seededModels } from '../../kit/transport';
import { headingText, Prose, word } from '../../kit/words';
import type {
  CassetteMissView,
  FetchRequest,
  ModelArm,
  ScanRequest,
  ScanResult,
  SourceFile,
} from '../../sut/port';
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

function keysOf(v: unknown, out: Map<string, unknown> = new Map(), prefix = ''): Map<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) {
      out.set(`${prefix}${k}`.toLowerCase().replace(/[^a-z0-9.]/g, ''), x);
      keysOf(x, out, `${prefix}${k}.`);
    }
  }
  return out;
}

/**
 * The cassette miss of a failed replay, as the reader's structured fields (the key of the request, the names of
 * the readable fields that differ from the nearest entry, that entry's key, the labeler id of the request). An
 * item reads these, never the words of the failure message.
 */
const missOf = (res: ScanResult): CassetteMissView | string =>
  res.miss ?? `the failed replay carries no structured cassette miss: ${res.error}`;

/** The one labeler id every entry of a committed fixture declares: the id its requests carry. */
function declaredLabeler(fixture: Pick<Fixture, 'rows'>): string {
  const ids = [...new Set(fixture.rows.map((row) => row.readable.labeler))];
  const [id] = ids;
  if (ids.length !== 1 || !id)
    throw new Error(`positive witness: the fixture declares ${ids.length} labeler ids`);
  return id;
}

async function positiveReplay(ctx: ItemContext, arm: ModelArm = 'haiku') {
  const fixture = loadFixture(arm);
  const { res, fake } = await replay(ctx, fixture.files, arm, fixture.cassette, {
    labelsYaml: fixture.labelsYaml,
  });
  requireFixtureLabels(res, fixture);
  if (fake.count) throw new Error('fixture replay called transport');
  return { fixture, res };
}
/** Replays the committed fixture of `arm` with one input changed: the failed replay and the fixture it came from. */
async function changedReplay(
  ctx: ItemContext,
  edit: (files: SourceFile[], texts: string[][], yaml: string) => { files: SourceFile[]; yaml: string },
  arm: ModelArm,
) {
  const { fixture } = await positiveReplay(ctx, arm);
  const changed = edit(
    fixture.files,
    fixture.documents.map((d) => d.units.map((u) => u.text)),
    fixture.labelsYaml,
  );
  if (JSON.stringify(changed.files) === JSON.stringify(fixture.files) && changed.yaml === fixture.labelsYaml)
    return fail('the miss probe did not change an input');
  const { res, fake } = await replay(ctx, changed.files, arm, fixture.cassette, { labelsYaml: changed.yaml });
  if (res.ok) return fail('changed request incorrectly replayed');
  if (fake.count) return fail('miss reached network');
  const miss = missOf(res);
  return typeof miss === 'string' ? fail(miss) : { fixture, miss };
}
/** A changed input whose nearest recorded entry differs from it in (at least) one of `fields`, by the reader's field names. */
async function missCase(
  ctx: ItemContext,
  edit: (files: SourceFile[], texts: string[][], yaml: string) => { files: SourceFile[]; yaml: string },
  fields: string[],
  arm: ModelArm = 'haiku',
): Promise<Outcome> {
  const seen = await changedReplay(ctx, edit, arm);
  if ('pass' in seen) return seen;
  const { miss } = seen;
  return fields.some((field) => miss.differs.includes(field))
    ? pass('miss names changed input')
    : fail(`the miss differs in [${miss.differs.join(', ')}], in none of ${fields.join(', ')}`);
}
/**
 * A changed input no recorded entry shares a file, a window and a set with (a new file, a renamed set): the miss
 * has no nearest entry and no differing field, it carries the id of the labeler the request carries, and its key
 * is no recorded key, so the entries the cassette holds for the unchanged inputs all still answer.
 */
async function missWithoutSibling(
  ctx: ItemContext,
  edit: (files: SourceFile[], texts: string[][], yaml: string) => { files: SourceFile[]; yaml: string },
  arm: ModelArm = 'haiku',
): Promise<Outcome> {
  const seen = await changedReplay(ctx, edit, arm);
  if ('pass' in seen) return seen;
  const { fixture, miss } = seen;
  if (miss.nearest !== undefined || miss.differs.length > 0)
    return fail(
      `the miss names a nearest entry (it differs in [${miss.differs.join(', ')}]) for an input no entry shares a file, a window and a set with`,
    );
  if (miss.labeler !== declaredLabeler(fixture))
    return fail(`the miss carries the labeler id ${String(miss.labeler)}, not ${declaredLabeler(fixture)}`);
  return fixture.rows.some((row) => row.key === miss.key)
    ? fail('the missing request has the key of a recorded entry')
    : pass('miss has no nearest entry, names the labeler id, and is no recorded request');
}
async function staleCassette(
  ctx: ItemContext,
  fixture: ReturnType<typeof loadFixture> & { files: SourceFile[] },
  arm: ModelArm,
  field: string,
  value: string,
  environment = false,
): Promise<Outcome> {
  const changed = perturb(fixture, arm, ctx.seed, field, value);
  const { res, fake } = await replay(ctx, fixture.files, arm, changed.cassette, {
    labelsYaml: fixture.labelsYaml,
  });
  if (res.ok) return fail('a one-field stale cassette was accepted');
  if (fake.count) return fail('the miss reached the network');
  const miss = missOf(res);
  if (typeof miss === 'string') return fail(miss);
  if (!miss.differs.includes(field))
    return fail(`the miss differs in [${miss.differs.join(', ')}], not in ${field}`);
  // The Node and ICU versions of a cut digest miss are the fields of its environment, never words of its message.
  if (environment) {
    const seen = miss.environment;
    if (!seen) return fail('the miss carries no environment: the Node and ICU versions of the run are missing');
    if (seen.node !== process.versions.node)
      return fail(`the miss omits the Node version of the run: its environment is ${JSON.stringify(seen)}`);
    if (seen.icu !== (process.versions.icu ?? ''))
      return fail(`the miss omits the ICU version of the run: its environment is ${JSON.stringify(seen)}`);
  }
  return pass(`miss names ${field}`);
}
const fixtureMissCase =
  (arm: ModelArm, field: string, value: string, environment = false): Run =>
  async (ctx) => {
    const { fixture } = await positiveReplay(ctx, arm);
    return staleCassette(ctx, fixture, arm, field, value, environment);
  };

export const replayRuns: Record<string, Run> = {
  // Legacy IDs are retained. Each now pairs exhaustive valid replay with exactly one stale input field.
  'fixture-haiku-replays-committed': fixtureMissCase('haiku', 'part.messages', 'changed'),
  'fixture-jev-replays-committed': fixtureMissCase('jev', 'part.state', 'changed'),
  'fixture-jev-unit-replays-committed': fixtureMissCase('jev-unit', 'path', 'changed.md'),
  'fixture-replay-twice-identical': async (ctx) => {
    // The original check: replaying the committed fixture again, with the first ledger as the previous one, gives the same ledger bytes.
    const { fixture, res: first } = await positiveReplay(ctx, 'haiku');
    const firstRaw = must(first, 'the first replay');
    const { res: second, fake } = await replay(ctx, fixture.files, 'haiku', fixture.cassette, {
      labelsYaml: fixture.labelsYaml,
      previousLedger: firstRaw,
    });
    if (!second.ok || !second.ledger) return fail(`the second replay failed: ${second.error}`);
    if (fake.count) return fail('the second replay reached the network');
    if (second.ledger.raw !== firstRaw) return fail('the second replay changed the ledger');
    // Kept beside it: a one-field stale window in the cassette is refused by name.
    return staleCassette(ctx, fixture, 'haiku', 'window', 'changed#1');
  },
  'fixture-miss-names-model': fixtureMissCase('haiku', 'model', 'claude-haiku-4-0'),
  'fixture-miss-names-prompt-version': fixtureMissCase('haiku', 'promptVersion', 'p0'),
  'fixture-miss-names-schema-version': fixtureMissCase('haiku', 'schemaVersion', 's0'),
  'fixture-miss-names-set-hash': fixtureMissCase('haiku', 'setHash', '0000000000000000'),
  'fixture-miss-names-labeler': fixtureMissCase('haiku', 'labeler', 'jev'),
  'fixture-miss-names-system-part': fixtureMissCase('haiku', 'part.system', '000000000000'),
  'fixture-miss-names-questions-part': fixtureMissCase('jev-unit', 'part.questions', '000000000000'),
  'fixture-miss-names-cut-digest': fixtureMissCase('haiku', 'cutDigest', '0'.repeat(64), true),
  'record-then-replay-identical': async (ctx) => {
    const { fixture, res } = await positiveReplay(ctx);
    const fake = fakeTransport({
      truth: (text) => fixture.expected.find((e) => e.quote === text)?.label ?? 'none',
    });
    const rec = await ctx.sut.scan({
      files: fixture.files,
      labelsYaml: fixture.labelsYaml,
      model: { arm: 'haiku', transport: fake },
      cassette: {
        mode: 'record',
        text: fixture.rows
          .slice(1)
          .map((r) => JSON.stringify(r))
          .concat('')
          .join('\n'),
      },
    });
    requireFixtureLabels(rec, fixture);
    if (fake.count !== 1) return fail('record must fill exactly the missing fixture window');
    return rec.ledger?.raw === res.ledger?.raw && JSON.stringify(rec.atoms) === JSON.stringify(res.atoms)
      ? pass('authored fixture replay equals record byte for byte')
      : fail('record and replay ledger or atoms differ');
  },
  'replay-twice-identical': async (ctx) => {
    const a = await positiveReplay(ctx),
      b = await positiveReplay(ctx);
    return a.res.ledger?.raw === b.res.ledger?.raw &&
      JSON.stringify(a.res.atoms) === JSON.stringify(b.res.atoms)
      ? pass('identical')
      : fail('two fixture replays differ');
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
    const { fixture } = await positiveReplay(ctx);
    const off = await replay(ctx, fixture.files, 'haiku', '', { labelsYaml: fixture.labelsYaml });
    if (off.res.ok || off.fake.count) return fail('empty replay did not fail offline');
    const fake = fakeTransport();
    await record(fixture.files, 'haiku', fake, { labelsYaml: fixture.labelsYaml }, ctx);
    // The system 2 labeler asks every window once per independent run (design, "The default stack"): three windows, three runs each.
    if (fake.count !== fixture.rows.length)
      return fail(
        `record must call every window once per run: ${fake.count} calls, expected ${fixture.rows.length}`,
      );
    const again = fakeTransport();
    const second = await ctx.sut.scan({
      files: fixture.files,
      labelsYaml: fixture.labelsYaml,
      model: { arm: 'haiku', transport: again },
      cassette: { mode: 'record', text: fixture.cassette },
    });
    requireFixtureLabels(second, fixture);
    return again.count === 0
      ? pass('offline miss, one record call per window and run, zero fixture reuse calls')
      : fail('existing committed entries were re-recorded');
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
    missCase(ctx, (f, _t, yaml) => ({ files: f, yaml: yaml.replaceAll('name: example', 'name: summary') }), [
      'setHash',
      'part.output',
      'part.user',
    ]),
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
        const was = t[1]?.[2] as string;
        const edited = f.map((file, i) =>
          i === 1
            ? {
                ...file,
                // The unit comes from a committed fixture, not from the generator: a drawn word is added to it.
                text: file.text.replace(was, `${was.replace(/\.$/, '')} ${word(p.random)}.`),
              }
            : file,
        );
        return { files: edited, yaml };
      },
      ['part.messages', 'part.user', 'cutDigest'],
    ),
  'miss-names-new-file': (ctx) =>
    missWithoutSibling(ctx, (f, _t, yaml) => ({
      files: [...f, { path: 'notes/d.md', text: compose([para(prose(ctx).next())]).text }],
      yaml,
    })),
  'miss-names-cut-digest': fixtureMissCase('haiku', 'cutDigest', 'tampered'),
  'miss-names-labeler': async (ctx) => {
    for (const arm of ['haiku', 'jev'] as const) {
      const own = await positiveReplay(ctx, arm),
        other = loadFixture(arm === 'haiku' ? 'jev' : 'haiku');
      // The missing entry's id is the one its own fixture declares: a token, not a word such as `labeler`.
      const id = declaredLabeler(own.fixture),
        foreign = declaredLabeler(other);
      if (id === foreign) throw new Error(`positive witness: both fixtures declare the labeler id ${id}`);
      const { res, fake } = await replay(ctx, own.fixture.files, arm, other.cassette, {
        labelsYaml: own.fixture.labelsYaml,
      });
      if (res.ok || fake.count) return fail(`wrong-arm cassette did not fail offline: ${res.error}`);
      if (res.miss?.labeler !== id)
        return fail(
          `the ${arm} arm on the cassette of ${foreign}: the miss does not name the labeler id ${id} of the missing entry: labeler of the miss: ${res.miss ? String(res.miss.labeler) : `no structured miss (${res.error})`}`,
        );
    }
    return pass('both arms refuse the other fixture and name the labeler id of the missing entry');
  },
  'miss-names-set-name': (ctx) =>
    missWithoutSibling(ctx, (f, _t, yaml) => ({
      files: f,
      yaml: yaml.replace('set: probe', 'set: renamed'),
    })),
  'miss-names-nearest-entry': async (ctx) => {
    const { fixture } = await positiveReplay(ctx);
    const edited = fixture.files.map((f, i) =>
      i === 1 ? { ...f, text: f.text.replace('receipt', 'voucher') } : f,
    );
    const { res } = await replay(ctx, edited, 'haiku', fixture.cassette, { labelsYaml: fixture.labelsYaml });
    const near = fixture.rows.find((row) => row.key === res.miss?.nearest);
    return !res.ok && near?.readable.path === 'notes/b.md' && near.readable.window === 'notes/b.md#1'
      ? pass('nearest window named')
      : fail(`nearest window missing: the nearest entry is ${near ? near.readable.window : 'none'}`);
  },
  'cut-digest-mismatch-names-versions': fixtureMissCase('haiku', 'cutDigest', 'tampered', true),
  'repeat-run-is-part-of-key': async (ctx) => {
    const { files } = threeFiles(ctx);
    const fake = fakeTransport();
    const rec = await record(files, 'haiku', fake, { labelsYaml: RULES_YAML }, ctx);
    must(rec, 'record');
    const keys = lines(rec.cassette ?? '').map((l) => (JSON.parse(l) as { key?: string }).key);
    const want = files.length * RUNS.haiku;
    if (keys.length !== want || new Set(keys).size !== want)
      return fail(
        `${keys.length} entries with ${new Set(keys).size} distinct keys, expected ${want}: one per window and run`,
      );
    return fake.count === want
      ? pass(`${want} runs, ${want} keys, ${want} calls`)
      : fail(`${fake.count} transport calls for ${want} runs: a run reused the answer of another`);
  },
  'cassette-ascending-keys': async (ctx) => {
    const { files } = threeFiles(ctx);
    const cassettes: string[] = [];
    for (const order of [files, [...files].reverse()]) {
      const rec = await record(order, 'haiku', fakeTransport(), { labelsYaml: RULES_YAML }, ctx);
      must(rec, 'record');
      const keys = lines(rec.cassette ?? '').map((l) => String((JSON.parse(l) as { key?: string }).key));
      if (keys.length < 2) return fail('positive witness: the cassette holds fewer than two entries');
      const sorted = [...keys].sort((a, b) => a.localeCompare(b));
      if (JSON.stringify(sorted) !== JSON.stringify(keys))
        return fail('the entries of the cassette are not in ascending key order');
      cassettes.push(rec.cassette ?? '');
    }
    return cassettes[0] === cassettes[1]
      ? pass('ascending keys, whatever the order of the files')
      : fail('the cassette depends on the order the entries were recorded in');
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
    const { fixture } = await positiveReplay(ctx, 'jev');
    const { res, fake } = await replay(
      ctx,
      fixture.files,
      'jev',
      fixture.cassette,
      { labelsYaml: fixture.labelsYaml },
      0.9,
    );
    requireFixtureLabels(res, fixture);
    return fake.count === 0 ? pass('threshold is outside key') : fail('threshold change called transport');
  },
  'key-ignores-clone-path': async (ctx) => {
    const { fixture, res: a } = await positiveReplay(ctx);
    const { res: b } = await replay(ctx, fixture.files, 'haiku', fixture.cassette, {
      labelsYaml: fixture.labelsYaml,
      location: { parent: 'different-parent', name: 'clone' },
    });
    requireFixtureLabels(b, fixture);
    return a.ledger?.raw === b.ledger?.raw ? pass('same ledger') : fail('clone path changed ledger');
  },
  'key-ignores-yaml-formatting': async (ctx) => {
    const { fixture } = await positiveReplay(ctx);
    const { res, fake } = await replay(ctx, fixture.files, 'haiku', fixture.cassette, {
      labelsYaml: `# only formatting\n${fixture.labelsYaml.replace('set: probe', 'set: "probe"')}`,
    });
    requireFixtureLabels(res, fixture);
    return fake.count === 0 ? pass('format-independent') : fail('formatting called transport');
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
    const { fixture } = await positiveReplay(ctx);
    // Round 3 audit, seat 2: the models come from the seed, and a re-record whose models agree must warn of
    // nothing, so a warning literal or a warning given on every scan gains nothing.
    const { recorded, returned } = seededModels(ctx.seed, ctx.id);
    const reRecord = (cassetteModel: string, transportModel: string) => {
      const rows = structuredClone(fixture.rows).slice(1);
      for (const row of rows) row.answer.returnedModel = cassetteModel;
      return ctx.sut.scan({
        files: fixture.files,
        labelsYaml: fixture.labelsYaml,
        model: { arm: 'haiku', transport: fakeTransport({ model: transportModel }) },
        cassette: {
          mode: 'record',
          text: rows
            .map((r) => JSON.stringify(r))
            .concat('')
            .join('\n'),
        },
      });
    };
    const res = await reRecord(recorded, returned);
    if (!res.ok) return fail(`re-record failed: ${res.error}`);
    if (
      !res.warningRecords?.some(
        (w) => w.code === 'model-mismatch' && w.recorded === recorded && w.returned === returned,
      )
    )
      return fail('returned-model warning missing');
    const same = await reRecord(recorded, recorded);
    if (!same.ok) return fail(`the re-record whose models agree failed: ${same.error}`);
    if (!Array.isArray(same.warningRecords)) return fail('the second re-record exposes no warnings');
    return same.warningRecords.length === 0
      ? pass('both model IDs named; models that agree give no warning')
      : fail(`a re-record whose models agree warns: ${JSON.stringify(same.warningRecords).slice(0, 120)}`);
  },
  'carry-forward-needs-only-dirty-entries': async (ctx) => {
    const { fixture, res: before } = await positiveReplay(ctx);
    const documents = structuredClone(fixture.documents);
    const dirty = documents[1];
    if (!dirty) return fail('fixture lacks second file');
    dirty.units = dirty.units.map((u) => ({
      ...u,
      text: u.text.replace(/\.$/, ' beside the red notebook.'),
    }));
    const changed = makeFixture('haiku', documents, fixture.labelsYaml);
    const onlyDirty = changed.rows
      .filter((r) => r.readable.path === dirty.path)
      .map((r) => JSON.stringify(r))
      .concat('')
      .join('\n');
    const { res, fake } = await replay(ctx, changed.files, 'haiku', onlyDirty, {
      labelsYaml: fixture.labelsYaml,
      previousLedger: must(before, 'baseline replay'),
    });
    requireFixtureLabels(res, changed);
    return fake.count === 0 ? pass('only dirty file entry needed') : fail('carry-forward called transport');
  },
  'fresh-replay-needs-all-entries': async (ctx) => {
    const { fixture } = await positiveReplay(ctx);
    // Every run of the first window is removed: a window with some runs recorded would miss on the run, not on the window.
    const first = fixture.rows[0]?.readable.window;
    const { res, fake } = await replay(
      ctx,
      fixture.files,
      'haiku',
      fixture.rows
        .filter((r) => r.readable.window !== first)
        .map((r) => JSON.stringify(r))
        .concat('')
        .join('\n'),
      { labelsYaml: fixture.labelsYaml },
    );
    const removed = fixture.rows.filter((row) => row.readable.window === first).map((row) => row.key);
    return !res.ok &&
      fake.count === 0 &&
      res.miss !== undefined &&
      res.miss.nearest === undefined &&
      removed.includes(res.miss.key)
      ? pass('missing window named')
      : fail('fresh replay did not reject missing entry');
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
    const fixture = loadFixture('haiku');
    const fake = fakeTransport();
    const again = await ctx.sut.scan({
      files: fixture.files,
      labelsYaml: fixture.labelsYaml,
      model: { arm: 'haiku', transport: fake },
      cassette: { mode: 'record', text: `${JSON.stringify(fixture.rows[0])}\n` },
    });
    if (!again.ok) return fail(`the second record run failed: ${again.error}`);
    const rest = fixture.rows.length - 1;
    return fake.count === rest
      ? pass(`one entry kept, ${rest} calls to finish`)
      : fail(
          `${fake.count} calls to finish a recording of ${fixture.rows.length} requests (3 windows, one request per run) with 1 entry, expected ${rest}`,
        );
  },
  'answers-frozen-despite-random-transport': async (ctx) => {
    const { fixture, res: baseline } = await positiveReplay(ctx);
    for (let i = 0; i < 2; i++) {
      const wild = fakeTransport({ truth: () => (Math.random() < 0.5 ? 'rule' : 'prohibition') });
      const res = await ctx.sut.scan({
        files: fixture.files,
        labelsYaml: fixture.labelsYaml,
        model: { arm: 'haiku', transport: wild },
        cassette: { mode: 'replay', text: fixture.cassette },
      });
      requireFixtureLabels(res, fixture);
      if (wild.count || res.ledger?.raw !== baseline.ledger?.raw)
        return fail('replay used random transport or changed ledger');
    }
    return pass('committed answers stay frozen');
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
    const { fixture } = await positiveReplay(ctx, 'jev-unit');
    const other = loadFixture('haiku');
    const { res, fake } = await replay(ctx, fixture.files, 'jev-unit', other.cassette, {
      labelsYaml: fixture.labelsYaml,
    });
    return !res.ok && fake.count === 0 && res.miss?.labeler === declaredLabeler(fixture)
      ? pass('own fixture works, other arm refused')
      : fail('wrong arm accepted or unnamed');
  },
  'replay-env-independent': async (ctx) => {
    const { fixture, res } = await positiveReplay(ctx);
    const files = fixture.files;
    const ledger = must(res, 'committed replay');
    const envs: Array<{ env: Record<string, string>; cwdName: string }> = [
      { env: { TZ: 'UTC', LANG: 'en_US.UTF-8' }, cwdName: 'one' },
      { env: { TZ: 'Asia/Kolkata', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' }, cwdName: 'two' },
      { env: { TZ: 'America/Sao_Paulo', LANG: 'C' }, cwdName: 'three' },
    ];
    for (const e of envs) {
      const out = await runChild(
        {
          kind: 'scan',
          files,
          labelsYaml: fixture.labelsYaml,
          model: { arm: 'haiku' },
          cassette: { mode: 'replay', text: fixture.cassette },
        },
        e,
      );
      try {
        const r = out.output?.ok ? (out.output.result as ScanResult) : undefined;
        if (!r?.ok)
          return fail(
            `a child replay failed: ${out.output && !out.output.ok ? out.output.error : (r?.error ?? out.stderr.slice(0, 200))}`,
          );
        requireFixtureLabels(r, fixture);
        if (r.ledger?.raw !== ledger)
          return fail(`the replay under ${JSON.stringify(e.env)} differs from the recording`);
      } finally {
        out.cleanup();
      }
    }
    return pass('three environments, one ledger');
  },
};

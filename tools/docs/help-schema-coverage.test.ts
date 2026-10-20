import { describe, expect, it } from 'vitest';
import { initializeShippedObjects } from '../../packages/checks/src/initialize';
import { PROJECT_CONFIG_KEYS } from '../../packages/cli/src/aggregate-config';
import { loadHelpTopics } from '../../packages/cli/src/help-topics';
import { objectRegistry } from '../../packages/core/src/objects';
import { WorldState } from '../../packages/core/src/schema/common';
import { CampaignConfig, CampaignRetryConfig } from '../../packages/core/src/schema/config';
import { LINK_CREATORS, LINK_RELATIONS, LINK_STATUSES } from '../../packages/core/src/schema/links';
import { AppliesTo, Envelope, Item, ItemPatch, Uses } from '../../packages/core/src/schema/object';
import { BlockStatus, Campaign, NotRun, RunResult } from '../../packages/core/src/schema/run';
import { BlockSpec, GivenDefaults, GivenOverride, Spec } from '../../packages/core/src/schema/spec';
import { documentsKey, schemaObjects, section, type UnitOverride, unitsForObject } from './help-coverage';

const topics = loadHelpTopics();
const groups = [
  { name: 'campaign', keys: Object.keys(CampaignConfig.shape), topics: ['running-campaign-config'] },
  {
    name: 'campaign.retry',
    keys: Object.keys(CampaignRetryConfig.shape),
    topics: ['running-campaign-config'],
  },
  {
    name: 'blocks[]',
    keys: Object.keys(BlockSpec.shape),
    topics: ['authoring-blocks', 'authoring-parent-blocks'],
  },
  { name: 'given', keys: Object.keys(GivenDefaults.shape), topics: ['authoring-prefixes'] },
  { name: 'blocks[].given', keys: Object.keys(GivenOverride.shape), topics: ['authoring-prefixes'] },
  { name: 'given.world', keys: Object.keys(WorldState.shape), topics: ['authoring-prefixes'] },
  {
    name: 'given.world.workspace',
    keys: Object.keys(WorldState.shape.workspace.unwrap().shape),
    topics: ['authoring-prefixes', 'authoring-parent-blocks'],
  },
];

describe('block and campaign schema help', () => {
  for (const group of groups) {
    it(`documents every ${group.name} key from the schema`, () => {
      const text = topics
        .filter((t) => group.topics.includes(t.id))
        .map((t) => section(t.body, 'Inputs') + section(t.body, 'Commands and every option'))
        .join('\n');
      for (const key of group.keys) {
        expect(text, `${group.name}.${key}`).toMatch(
          new RegExp(`\x60(?:[a-zA-Z0-9_.\\[\\]]*\\.)?${key}\x60`),
        );
      }
    });
  }
});

/** The topics that describe the spec. An object is looked up in these, by its own key, never by a word alone. */
const SPEC_TOPICS = [
  'authoring-spec-format',
  'authoring-blocks',
  'authoring-parent-blocks',
  'authoring-prefixes',
  'authoring-perturbations',
  'judging-check-text',
  'judging-check-tools',
  'judging-check-runtime',
  'judging-machine-checks',
  'judging-criteria',
  'judging-opt-in-settings',
];
/** Where an object is described when no heading, label line or table row opens with its own key. */
const SPEC_UNITS: Record<string, UnitOverride[]> = {
  '(root)': [{ topic: 'authoring-spec-format', heading: 'Top-level keys' }],
  'blocks[]': [{ topic: 'authoring-blocks', heading: 'Block keys' }],
  'blocks[].when.injection': [{ topic: 'authoring-blocks', paragraph: 'A block takes exactly one of' }],
  'blocks[].expect.tools[].compare': [{ topic: 'judging-check-tools', heading: 'The value-check ladder' }],
  'blocks[].expect.tools[].compare{}': [{ topic: 'judging-check-tools', heading: 'The value-check ladder' }],
  'blocks[].given.prefix[]': [{ topic: 'authoring-prefixes', heading: 'A message of the prefix' }],
  'blocks[].given.prefix[].tool_calls[]': [
    { topic: 'authoring-prefixes', heading: 'A tool call in a prefix' },
  ],
};

/** Every key of every object of a schema must be named in code in the units that document that object. */
function undocumented(
  schema: unknown,
  pool: string[],
  units: Record<string, UnitOverride[]>,
  skip: RegExp,
): string[] {
  const owners = topics.filter((t) => pool.includes(t.id));
  const missing: string[] = [];
  for (const { path, keys } of schemaObjects(schema)) {
    if (skip.test(path)) continue;
    const found = unitsForObject(path, owners, units);
    if (found.length === 0) missing.push(`${path}: no unit documents this object`);
    for (const key of keys)
      if (found.length > 0 && !found.some((unit) => documentsKey(unit.text, key)))
        missing.push(`${path}.${key}`);
  }
  return missing;
}

describe('spec help', () => {
  it('documents every key of every object of the spec schema, in the section of that object', () => {
    // A perturbation takes the expectations of a block; its path would repeat every key. An inline object of
    // `uses` has the keys of an object file; the 'object help' tests below check those once, in their own tables.
    expect(
      undocumented(
        Spec,
        SPEC_TOPICS,
        SPEC_UNITS,
        /^perturbations\[\]\.expect|(^|\.)uses\.[a-z_]+(\[\]|\.|$)/,
      ),
    ).toEqual([]);
  });
});

/** The topics that describe a stored record: any of them may hold the unit of an object. */
const RECORD_TOPICS = [
  'running-store',
  'running-retries',
  'running-tool-history',
  'running-process-and-sandboxes',
  'running-not-run',
  'running-outcomes',
  'running-realized-text',
  'running-change-carry',
  'authoring-parent-blocks',
  'judging-campaign-rejudge',
];
const BLOCK_KEYS = { topic: 'running-store', paragraph: 'Each block (`blocks[]`) holds' };
const BLOCK_STAMPS = { topic: 'running-store', paragraph: 'Each block also holds the block `provenance`' };
const DIAGNOSIS = { topic: 'running-store', label: 'Each entry of `diagnoses`' };
const RUN_UNITS: Record<string, UnitOverride[]> = {
  '(root)': [
    { topic: 'running-store', paragraph: 'A run record holds' },
    { topic: 'running-store', heading: 'Run record, field by field' },
  ],
  'blocks[]': [BLOCK_KEYS],
  'blocks[].ledgerCheck': [BLOCK_KEYS],
  'blocks[].notRun': [BLOCK_KEYS],
  'blocks[].blocked': [BLOCK_KEYS],
  'blocks[].provenance': [BLOCK_STAMPS],
  'blocks[].provenance.endState': [BLOCK_STAMPS],
  'blocks[].provenance.endState.values[]': [BLOCK_STAMPS],
  'blocks[].provenance.artifacts[]': [BLOCK_STAMPS],
  'blocks[].carried': [BLOCK_STAMPS, { topic: 'running-store', row: 'carried' }],
  'blocks[].observed.executions[]': [{ topic: 'running-store', paragraph: 'An `executions` record holds' }],
  'blocks[].observed.executions[].approval': [
    { topic: 'running-store', paragraph: 'An `executions` record holds' },
  ],
  'blocks[].verdicts[].by': [{ topic: 'running-store', label: 'The `by` of a verdict or a diagnosis' }],
  'blocks[].diagnoses[].by': [{ topic: 'running-store', label: 'The `by` of a verdict or a diagnosis' }],
  'blocks[].resolved': [{ topic: 'running-store', label: 'The `resolved` field of a block' }],
  'blocks[].resolved.objects[]': [{ topic: 'running-store', label: 'The `resolved` field of a block' }],
  'blocks[].diagnoses[]': [DIAGNOSIS],
  'blocks[].diagnoses[].rankedCauses[]': [DIAGNOSIS],
  'blocks[].verdicts[].judge.votes[]': [
    { topic: 'running-store', paragraph: 'A vote in `judge.votes` holds' },
  ],
};
const CAMPAIGN_UNITS: Record<string, UnitOverride[]> = {
  '(root)': [{ topic: 'running-store', heading: 'Campaign record, field by field' }],
};
/** A target is documented once, as the `target` of a spec. */
const TARGETS = /(^|\.)(target|targets\[\])(\.|$)/;

describe('stored record help', () => {
  it('documents every key of every object of the run record, in the section of that object', () => {
    expect(undocumented(RunResult, RECORD_TOPICS, RUN_UNITS, TARGETS)).toEqual([]);
  });

  it('documents every key of every object of the campaign record, in the section of that object', () => {
    expect(undocumented(Campaign, RECORD_TOPICS, CAMPAIGN_UNITS, TARGETS)).toEqual([]);
  });
});

describe('enumerated value help', () => {
  const values: Array<[string, readonly string[], string[]]> = [
    ['block status', BlockStatus.options, ['running-not-run', 'running-outcomes']],
    ['not_run kind', NotRun.shape.kind.options, ['running-not-run', 'running-outcomes']],
    ['link status', LINK_STATUSES, ['authoring-block-links']],
    ['link relation', LINK_RELATIONS, ['authoring-block-links']],
    ['link creator', LINK_CREATORS, ['authoring-block-links']],
  ];
  for (const [name, list, ids] of values) {
    it(`names every ${name}`, () => {
      const text = topics
        .filter((t) => ids.includes(t.id))
        .map((t) => t.body)
        .join('\n');
      const missing = list.filter(
        (value) => !new RegExp(`(?<![A-Za-z0-9_])${value}(?![A-Za-z0-9_])`).test(text),
      );
      expect(missing).toEqual([]);
    });
  }
});

describe('the schema help check', () => {
  it('lists the objects of a schema with their keys, and accepts only a key named in code', () => {
    const objects = schemaObjects(CampaignConfig);
    expect(objects.find((object) => object.path === '(root)')?.keys).toEqual(
      Object.keys(CampaignConfig.shape),
    );
    expect(objects.find((object) => object.path === 'retry')?.keys).toEqual(
      Object.keys(CampaignRetryConfig.shape),
    );
    expect(documentsKey('`new_key` sets the count.', 'new_key')).toBe(true);
    expect(documentsKey('```yaml\nadded: { new_key: 1 }\n```', 'new_key')).toBe(true);
    expect(documentsKey('new_key sets the count, written in prose.', 'new_key')).toBe(false);
    expect(documentsKey('`new_key_two` sets another count.', 'new_key')).toBe(false);
  });

  it('refuses a key that only another object of the same topic names', () => {
    // A key added to the root of the run record is not documented because `blockRerun.reason` names a `reason`.
    const owners = topics.filter((t) => RECORD_TOPICS.includes(t.id));
    const root = unitsForObject('(root)', owners, RUN_UNITS);
    expect(root.some((unit) => documentsKey(unit.text, 'runId'))).toBe(true);
    expect(root.some((unit) => documentsKey(unit.text, 'reason'))).toBe(false);
    // A key added to a vote is not documented because the executions of the same section name a `command`.
    const votes = unitsForObject('blocks[].verdicts[].judge.votes[]', owners, RUN_UNITS);
    expect(votes.some((unit) => documentsKey(unit.text, 'winner'))).toBe(true);
    expect(votes.some((unit) => documentsKey(unit.text, 'command'))).toBe(false);
  });

  it('refuses an override whose unit is gone', () => {
    expect(() =>
      unitsForObject('(root)', topics, {
        '(root)': [{ topic: 'running-store', heading: 'No such heading' }],
      }),
    ).toThrow(/is gone/);
  });
});

/** The text of a `###` section: from its heading to the next heading of the same or a higher level. */
function subsection(body: string, heading: string): string {
  const lines = body.split('\n');
  const start = lines.indexOf(`### ${heading}`);
  if (start < 0) return '';
  const end = lines.findIndex((line, at) => at > start && /^#{1,3} /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** The topic that describes objects: the file format, the kinds and the implementations. */
const OBJECT_TOPIC = 'authoring-objects';

describe('object help', () => {
  const objectTopic = topics.find((topic) => topic.id === OBJECT_TOPIC);

  it('has the topic', () => {
    expect(objectTopic, `help/${OBJECT_TOPIC}.md`).toBeDefined();
  });

  // The key tables of the topic: one heading per object of the file format, read as the units of that object.
  const OBJECT_UNITS: Array<[name: string, keys: string[], heading: string]> = [
    ['an object file', Object.keys(Envelope.shape), 'The keys of an object file'],
    ['an item of a root object', Object.keys(Item.shape), 'The keys of an item (a root object)'],
    [
      'an item operation',
      Object.keys(ItemPatch.shape),
      'The keys of an item operation (an object that extends another)',
    ],
  ];
  for (const [name, keys, heading] of OBJECT_UNITS) {
    it(`names every key of ${name} in its own table`, () => {
      const unit = subsection(objectTopic?.body ?? '', heading);
      expect(unit, `heading "${heading}"`).not.toBe('');
      const missing = keys.filter((key) => !documentsKey(unit, key));
      expect(missing).toEqual([]);
    });
  }

  it('names every key of every inline object of uses, in the tables of an object file, an item and an operation', () => {
    // The spec test skips the objects under `uses.<kind>`; their keys are checked here, from the live schema.
    const tables = OBJECT_UNITS.map(([, , heading]) => subsection(objectTopic?.body ?? '', heading)).join(
      '\n',
    );
    const inline = schemaObjects(Uses).filter(
      ({ path }) => /^[a-z_]+(\[\]|\.|$)/.test(path) && path !== '(root)',
    );
    expect(inline.length, 'the inline objects of uses were found').toBeGreaterThan(0);
    const missing = inline.flatMap(({ path, keys }) =>
      keys
        .filter((key) => !documentsKey(path.endsWith('applies_to') ? (objectTopic?.body ?? '') : tables, key))
        .map((key) => `uses.${path}.${key}`),
    );
    expect(missing).toEqual([]);
  });

  it('names every key of applies_to', () => {
    const text = objectTopic?.body ?? '';
    const missing = Object.keys(AppliesTo.shape).filter((key) => !documentsKey(text, key));
    expect(missing).toEqual([]);
  });

  it('names every registered kind and implementation', () => {
    initializeShippedObjects();
    const text = objectTopic?.body ?? '';
    const kinds = objectRegistry.kinds().map((kind) => kind.kind);
    const impls = objectRegistry.impls().map((impl) => impl);
    const named = (what: string) => text.includes(`\`${what}\``);
    // A check implementation is named once as `builtin:check/<name>` for all its checks; every other one by name.
    const missing = [
      ...kinds.filter((kind) => !named(kind)),
      ...impls.filter((impl) => !impl.startsWith('builtin:check/') && !named(impl)),
    ];
    expect(missing).toEqual([]);
    expect(impls.some((impl) => impl.startsWith('builtin:check/'))).toBe(true);
  });

  it('names every check of the shipped check set', () => {
    initializeShippedObjects();
    const text = objectTopic?.body ?? '';
    const checks = objectRegistry
      .impls()
      .filter((impl) => impl.startsWith('builtin:check/'))
      .map((impl) => impl.slice('builtin:check/'.length));
    expect(checks.filter((check) => !documentsKey(text, check))).toEqual([]);
  });
});

describe('project config help', () => {
  it('describes every top-level key of driftbench.yaml', () => {
    const text =
      topics
        .find((topic) => topic.id === 'core-configuration')
        ?.body.split('\n## ')
        .find((part) => part.startsWith('Commands and every option')) ?? '';
    const missing = PROJECT_CONFIG_KEYS.filter((key) => !text.includes(`* \`${key}\``));
    expect(missing).toEqual([]);
  });
});

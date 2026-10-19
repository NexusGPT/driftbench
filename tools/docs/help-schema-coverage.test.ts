import { describe, expect, it } from 'vitest';
import { initializeShippedObjects } from '../../packages/checks/src/initialize';
import { PROJECT_CONFIG_KEYS } from '../../packages/cli/src/aggregate-config';
import { loadHelpTopics } from '../../packages/cli/src/help-topics';
import { objectRegistry } from '../../packages/core/src/objects';
import { WorldState } from '../../packages/core/src/schema/common';
import { CampaignConfig, CampaignRetryConfig } from '../../packages/core/src/schema/config';
import { LINK_CREATORS, LINK_RELATIONS, LINK_STATUSES } from '../../packages/core/src/schema/links';
import { AppliesTo, Envelope, Item, ItemPatch } from '../../packages/core/src/schema/object';
import { BlockStatus, Campaign, NotRun, RunResult } from '../../packages/core/src/schema/run';
import { BlockSpec, GivenDefaults, GivenOverride, Spec } from '../../packages/core/src/schema/spec';
import { documentsKey, schemaObjects, section } from './help-coverage';

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

/** Where each object of the spec is described: the first pattern that matches its path picks the topics. */
const SPEC_OBJECT_TOPICS: Array<[RegExp, string[]]> = [
  [/given|prefix|\.world/, ['authoring-prefixes', 'authoring-parent-blocks']],
  [/^blocks\[\](\.when(\.injection)?)?$/, ['authoring-blocks', 'authoring-parent-blocks']],
  [/^perturbations\[\](\.recovery)?$/, ['authoring-perturbations', 'authoring-blocks']],
  [
    /expect|budget/,
    [
      'authoring-blocks',
      'authoring-spec-format',
      'judging-check-text',
      'judging-check-tools',
      'judging-check-runtime',
      'judging-machine-checks',
      'judging-criteria',
      'judging-opt-in-settings',
    ],
  ],
  [/.*/, ['authoring-spec-format', 'judging-criteria', 'judging-opt-in-settings']],
];

const inputsOf = (ids: string[]) =>
  topics
    .filter((t) => ids.includes(t.id))
    .map((t) => section(t.body, 'Inputs') + section(t.body, 'Commands and every option'))
    .join('\n');

describe('spec help', () => {
  it('documents every key of every object of the spec schema', () => {
    const missing: string[] = [];
    for (const { path, keys } of schemaObjects(Spec)) {
      // A perturbation takes the same expectations as a block; its path would repeat every key.
      if (path.startsWith('perturbations[].expect')) continue;
      const owners = SPEC_OBJECT_TOPICS.find(([pattern]) => pattern.test(path))?.[1] ?? [];
      const text = inputsOf(owners);
      for (const key of keys) if (!documentsKey(text, key)) missing.push(`${path}.${key}`);
    }
    expect(
      missing,
      'Add the key to the Inputs or Commands section of the topic that owns its object.',
    ).toEqual([]);
  });
});

/** Where each stored record is described: any section counts, since a record is read as output. */
const RECORD_TOPICS = [
  'running-store',
  'running-not-run',
  'running-outcomes',
  'running-realized-text',
  'running-change-carry',
  'authoring-parent-blocks',
  'judging-campaign-rejudge',
];
const RECORD_OBJECTS = [
  '(root)',
  'blocks[]',
  'blocks[].notRun',
  'blocks[].blocked',
  'blocks[].carried',
  'blocks[].rejudged',
  'blocks[].provenance',
  'blockRerun',
  'rejudged',
  'carried',
  'provenance',
  'provenance.driver',
  'provenance.adapter',
  'succession',
  'recovery',
  'endState',
];

/** The objects a block reports: what the agent did, what judged it, and what the run announced. */
const OUTPUT_TOPICS = [
  'running-store',
  'running-retries',
  'running-tool-history',
  'running-process-and-sandboxes',
  'judging-evidence',
  'judging-council',
];
const OUTPUT_OBJECTS = [/^blocks\[\]\.(observed|verdicts)/, /^events/];

describe('stored record help', () => {
  it('documents every key of the run record and of the block, carry, rejudge and provenance objects', () => {
    const text = topics
      .filter((t) => RECORD_TOPICS.includes(t.id))
      .map((t) => t.body)
      .join('\n');
    const missing: string[] = [];
    for (const { path, keys } of schemaObjects(RunResult)) {
      if (!RECORD_OBJECTS.includes(path)) continue;
      for (const key of keys) if (!documentsKey(text, key)) missing.push(`run.${path}.${key}`);
    }
    expect(missing).toEqual([]);
  });

  it('documents every key of the observed record, the verdicts and the events of a run', () => {
    const text = topics
      .filter((t) => OUTPUT_TOPICS.includes(t.id))
      .map((t) => t.body)
      .join('\n');
    const missing: string[] = [];
    for (const { path, keys } of schemaObjects(RunResult)) {
      if (!OUTPUT_OBJECTS.some((pattern) => pattern.test(path))) continue;
      for (const key of keys) if (!documentsKey(text, key)) missing.push(`run.${path}.${key}`);
    }
    expect(missing).toEqual([]);
  });

  it('documents every key of the campaign record', () => {
    const text = topics
      .filter((t) => [...RECORD_TOPICS, 'results-radius', 'results-registry'].includes(t.id))
      .map((t) => t.body)
      .join('\n');
    const missing: string[] = [];
    for (const { path, keys } of schemaObjects(Campaign)) {
      if (!['(root)', 'provenance', 'provenance.adapters[]', 'rejudged[]', 'radius'].includes(path)) continue;
      for (const key of keys) if (!documentsKey(text, key)) missing.push(`campaign.${path}.${key}`);
    }
    expect(missing).toEqual([]);
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

  it('refuses a topic that leaves out a key of an object it owns', () => {
    const owned = inputsOf(['authoring-parent-blocks']);
    expect(documentsKey(owned, 'parent')).toBe(true);
    expect(documentsKey(owned, 'an_undocumented_key')).toBe(false);
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

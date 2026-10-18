import { describe, expect, it } from 'vitest';
import { loadHelpTopics } from '../../packages/cli/src/help-topics';
import { WorldState } from '../../packages/core/src/schema/common';
import { CampaignConfig, CampaignRetryConfig } from '../../packages/core/src/schema/config';
import { BlockSpec, GivenDefaults, GivenOverride } from '../../packages/core/src/schema/spec';
import { section } from './help-coverage';

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

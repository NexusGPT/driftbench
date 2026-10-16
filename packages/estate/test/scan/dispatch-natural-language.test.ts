import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

export const dispatchCorpus: Array<[string, boolean]> = [
  ['Call report for the summary.', true],
  ['Please call report.', true],
  ['You must call report.', true],
  ['Always dispatch report.', true],
  ['Invoke the report agent.', true],
  ['Delegate to report.', true],
  ['Spawn report for this task.', true],
  ['Launch report now.', true],
  ['Ask report for a summary.', true],
  ['Hand the task off to report.', true],
  ['If no objection is raised, call report.', true],
  ['Never call another helper, but call report.', true],
  ['Do not edit until you call report.', true],
  ['Call `report` now.', true],
  ['Use `report` for summaries.', true],
  ['You cannot call report.', false],
  ['You are not allowed to launch report.', false],
  ['Never, ever call report.', false],
  ['Never directly call report.', false],
  ['You may not invoke report.', false],
  ["You can't call `report`.", false],
  ['You must under no circumstances call report.', false],
  ['Optionally, call report.', false],
  ['Place a call report in the ticket.', false],
  ['The launch report is due Friday.', false],
  ['In the old flow we used to ask report for a schedule, which no longer happens.', false],
  ['The sentence is "Call report for a summary".', false],
  ['If you call report, record the result.', false],
  ['Do not call `report`.', false],
  ['Call report-extra.', false],
  ['1. Call report.', true],
  ['For this task, please call report.', true],
  ['When the file arrives, invoke report.', true],
  ['Please launch the helper named report.', true],
  ['You should ask report for help.', true],
  ['Remember to dispatch report.', true],
  ['Be sure to invoke report.', true],
  ['Call another helper; call report.', true],
  ['Do not call another helper. Call report.', true],
  ['Please delegate to the agent report.', true],
  ['You are not permitted to call report.', false],
  ['You must not ever spawn report.', false],
  ['Do not directly launch report.', false],
  ['Under no circumstances invoke report.', false],
  ['A call report belongs in the ticket.', false],
  ['The dispatch report is archived.', false],
  ['We used to launch report.', false],
  ['The helper `report` was retired.', false],
  ['If you invoke `report`, record the result.', false],
  ['Optionally, use `report`.', false],
  ['Immediately call `report`.', true],
  ['Directly invoke `report`.', true],
  ['Carefully ask report for a summary.', true],
  ['Have `report` summarize the draft.', true],
  ['Let `report` summarize the draft.', true],
  ['Send the draft to `report`.', true],
  ['Delegate the task to `report`.', true],
  ['You need to call `report`.', true],
  ['We have to invoke `report`.', true],
  ['Never directly call `report`.', false],
  ['You cannot have `report` summarize this.', false],
  ['Do not send the draft to `report`.', false],
];

describe('dispatch clauses', () => {
  it.each(dispatchCorpus)('%s => %s', async (sentence, expected) => {
    const root = await estate({
      '.claude/skills/summarize/SKILL.md': `---\nname: summarize\ndescription: Summarize documents.\n---\n${sentence}\n`,
      '.claude/agents/report.md': '---\nname: report\ndescription: Summarize documents.\n---\n',
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.edges.some((edge) => edge.kind === 'dispatch')).toBe(expected);
  });
});

import type { EstateMap } from '../../src/index';

type Kind = 'restart' | 'rate_wave' | 'compaction' | 'session_boundary' | 'notification' | 'nudge_storm';
export type HazardExample = { group: string; text: string; expected: Kind[] };
const rule = (text: string, ...expected: Kind[]): HazardExample => ({ group: 'recovery', text, expected });
const data = (group: string, text: string): HazardExample => ({ group, text, expected: [] });

/** Hand-written observatory policies and embedded documentary material; no validator fixtures. */
export const HAZARD_CORPUS: HazardExample[] = [
  rule('After your process restarts, inspect the unfinished observation.', 'restart'),
  rule('When the assistant is restarted, reload the telescope checklist.', 'restart'),
  rule('The supervisor restarts the agent after an upgrade; recover the exposure queue.', 'restart'),
  rule('If the service that you call reboots, retain the unfinished catalogue query.', 'restart'),
  rule('The instrument index invoked by the assistant returns 429; retain its cursor.', 'rate_wave'),
  rule('When you receive HTTP 429, checkpoint the current observation.', 'rate_wave'),
  rule('If the upstream endpoint answers "too many requests", preserve the catalogue cursor.', 'rate_wave'),
  rule('Treat "rate limit exceeded" as a signal to pause outgoing calls.', 'rate_wave'),
  rule('After a compaction, reload the observation notebook.', 'compaction'),
  rule('When your context is compacted, read the saved calibration decisions.', 'compaction'),
  rule('If the assistant conversation is summarized, recover its unfinished observation.', 'compaction'),
  rule('When the context window fills up, write the pending exposure to the notebook.', 'compaction'),
  rule('After the agent context is compacted, inspect the pending observation.', 'compaction'),
  rule('After a "compaction", restore the saved observation.', 'compaction'),
  rule('In a new session, read the saved observation notebook.', 'session_boundary'),
  rule('When you resume your own session, inspect the observing queue.', 'session_boundary'),
  rule('When a helper notification arrives, read its observation result.', 'notification'),
  rule('When a notification arrives from the optics worker, reconcile its result.', 'notification'),
  rule('Repeated guard nudges require checking the pending operation.', 'nudge_storm'),
  rule('When the hook nudges the assistant, inspect the rejected operation.', 'nudge_storm'),
  data('other-system', 'After database compaction, the archive needs less disk space.'),
  data('other-system', 'The storage engine performs compaction every night.'),
  data('other-system', 'The imaging service compacted an old image archive.'),
  data('other-system', 'The sample was compacted under pressure in the materials chamber.'),
  data('other-system', 'The telescope control panel restarts after its firmware update.'),
  data('other-system', 'Restart the reception display after its diagnostics.'),
  data('other-system', 'Our public endpoint returns 429 to visitors who exceed their quota.'),
  data('other-system', 'The service that visitors call returns HTTP 429.'),
  data('other-system', 'The assistant tells the visitor to restart the camera.'),
  data('other-system', 'The visitor conversation is summarized for the curator.'),
  data('other-system', 'The document context is summarized in its introduction.'),
  data('other-system', 'The archive context window fills up with indexed records.'),
  data('description', 'The handbook describes compaction for new observatory volunteers.'),
  data('description', 'This chapter explains what a process restart means.'),
  data('description', 'The calibration manual discusses the assistant context being compacted.'),
  data('description', 'This paragraph mentions rate limits as background terminology.'),
  data('description', 'The appendix contains a notification sent by an optics helper.'),
  data('description', 'The glossary defines repeated guard nudges as a term.'),
  data('description', 'The report describes a new session of the assistant.'),
  data('description', 'The service specification documents HTTP status 429.'),
  data('metrics', 'Compaction ratio is a column in the monitoring export.'),
  data('metrics', 'The process restart count appears beside the memory gauge.'),
  data('metrics', 'The rate limit histogram measures rejected requests.'),
  data('metrics', 'Helper notification volume appears in the capacity report.'),
  data('metrics', 'Repeated guard nudges per hour is a monitoring statistic.'),
  data('metrics', '| runtime compactions | 18 |'),
  data('metrics', '| assistant restarts | 7 |'),
  data('metrics', '| context compacted | 14.5% |'),
  data('metrics', '| rate limits | 28 requests |'),
  data('metrics', '| helper notification count | 22 |'),
  data('quoted-error', '"Your context was compacted"'),
  data('quoted-error', '"Your process restarted"'),
  data('quoted-error', '`rate limit exceeded`'),
  data('quoted-error', 'A log entry reads "your context was compacted".'),
  data('quoted-error', 'The diagnostic payload is "your process restarted".'),
  data('quoted-error', 'The field contains "too many requests" as a string.'),
  data('quoted-error', 'The glossary uses “context compacted” as its example wording.'),
  data('quoted-error', '> After a compaction, read the observation notebook.'),
  data(
    'example',
    '## Worked example\nAfter your process restarts, restore the simulated exposure.\n## Current recovery policy',
  ),
  data(
    'example',
    '## Illustrative transcript\nYour context is compacted.\n### Simulated response\nReload the notebook.\n## Current recovery policy',
  ),
  data(
    'example',
    '## Sample output\nWhen you receive HTTP 429, retain the cursor.\n## Current recovery policy',
  ),
  data('example', 'For example, the assistant context is compacted during the demonstration.'),
  data('example', 'An illustration of a process restart appears in the training material.'),
  data('example', 'Example: a helper notification arrives while the assistant waits.'),
  data(
    'history',
    '## Revision history\nThe assistant context was compacted during the old experiment.\n## Current recovery policy',
  ),
  data(
    'history',
    '## Historical observations\nThe agent restarts after an upgrade in the archived demonstration.\n## Current recovery policy',
  ),
  data('history', '- 2024-08-19: We recorded a compaction during the retired observing campaign.'),
  data('history', '| 2024-09-07 | The assistant was restarted during the old experiment. |'),
  data('history', 'The release notes describe how the context was compacted in an earlier version.'),
  data('history', 'The incident report records the helper notification from last year.'),
  data(
    'metrics',
    '## Recorded measurements\nCompaction occurred 18 times during the experiment.\nHelper notification volume increased.\n## Current recovery policy',
  ),
  // A nearby documentary example must not erase the independent current rule.
  rule('Example: "your process restarted"; after a compaction, read the notebook.', 'compaction'),
  rule('The panel reboots after maintenance; when your process restarts, recover the queue.', 'restart'),
];

export type LabeledPassage = HazardExample & { file: string; lines: number[] };
export function observatoryEstate(
  skills = 1,
  paddingCharacters = 0,
): { files: Record<string, string>; passages: LabeledPassage[] } {
  const paddingLine = 'Record the observation identifier and preserve the original exposure values.\n';
  const padding = paddingLine.repeat(Math.ceil(paddingCharacters / paddingLine.length));
  const files: Record<string, string> = { 'CLAUDE.md': `# Observatory operating policies\n${padding}` };
  const passages: LabeledPassage[] = [];
  for (let unit = 0; unit < skills; unit++) {
    const folder = `.claude/skills/observations-${unit}`;
    files[`${folder}/SKILL.md`] =
      `---\nname: observations-${unit}\ndescription: Analyze an observatory exposure.\n---\nRead references/policy.md before analyzing an exposure.\n`;
    const file = `${folder}/references/policy.md`;
    const lines = ['# Observatory operating policy', padding, '## Current recovery policy']
      .join('\n')
      .split('\n');
    for (const example of HAZARD_CORPUS) {
      // Source positions define the oracle, so large files and chunk boundaries cannot shift truth.
      const first = lines.length + 1;
      const body = example.text.split('\n');
      lines.push(...body, '');
      passages.push({ ...example, file, lines: body.map((_, i) => first + i) });
    }
    files[file] = lines.join('\n');
  }
  return { files, passages };
}

export function hazardMeasurement(map: EstateMap, passages: LabeledPassage[]) {
  const found = map.atoms.filter((a) => a.kind === 'hazard');
  const mistakes: Array<{ passage: LabeledPassage; actual: string[] }> = [];
  let tp = 0,
    fp = 0,
    fn = 0;
  const groups: Record<string, { tp: number; fp: number; fn: number }> = {};
  for (const passage of passages) {
    const actual = [
      ...new Set(
        found
          .filter((a) => a.provenance.file === passage.file && passage.lines.includes(a.provenance.startLine))
          .map((a) => String(a.fields?.hazard)),
      ),
    ];
    const row = groups[passage.group] ?? { tp: 0, fp: 0, fn: 0 };
    groups[passage.group] = row;
    const hits = actual.filter((h) => passage.expected.includes(h as Kind)).length;
    const extra = actual.length - hits;
    const missing = passage.expected.length - hits;
    tp += hits;
    fp += extra;
    fn += missing;
    row.tp += hits;
    row.fp += extra;
    row.fn += missing;
    if (extra || missing) mistakes.push({ passage, actual });
  }
  return { tp, fp, fn, precision: tp / (tp + fp || 1), recall: tp / (tp + fn || 1), groups, mistakes };
}

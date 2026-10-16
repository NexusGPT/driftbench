import { type RunResult, runOutcome } from '@agent-nexus/driftbench-core';
import { type CampaignData, groupBy, runPassed, showTarget } from './data';
import { historyNormalizationsText } from './format';

/** A run that completed and failed: a measured failure, a JUnit failure. */
function isFailure(run: RunResult): boolean {
  return run.status === 'completed' && runOutcome(run) === 'fail';
}

/** A run with a block not run or blocked and no failure: neither a pass nor a fail, a JUnit skip. */
function isUnscored(run: RunResult): boolean {
  const outcome = runOutcome(run);
  return run.status === 'completed' && (outcome === 'not_run' || outcome === 'blocked');
}

function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .split('')
    .filter((char) => allowedInXml(char.charCodeAt(0)))
    .join('');
}

/** XML 1.0 refuses every control character but tab, line feed and carriage return. */
function allowedInXml(code: number): boolean {
  return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/** The failing gating verdicts of a run and the end-state fields that differ, one line each. */
export function failures(run: RunResult): string[] {
  return [
    ...run.blocks.flatMap((block) =>
      block.verdicts
        .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
        .map((verdict) => `block ${block.index} ${verdict.id} ${verdict.outcome}: ${verdict.evidence}`),
    ),
    ...(run.endState && !run.endState.match
      ? run.endState.diff.map(
          (entry) =>
            `end_state ${entry.field}: expected ${JSON.stringify(entry.expected)}, observed ${JSON.stringify(entry.observed)}`,
        )
      : []),
  ];
}

/**
 * The campaign as JUnit XML: one test suite per golden, one test case per run. A run that completed and
 * did not pass is a failure listing its failing gating verdicts; a run that failed or was stopped is an
 * error; a run with a block not run or blocked, and no failure, is skipped with the reason. The timestamp
 * is the campaign's creation time, so the same store gives the same file.
 */
export function renderJunit(data: CampaignData): string {
  const suites = [...groupBy(data.runs, (run) => run.specId).entries()];
  const total = {
    tests: data.runs.length,
    failures: data.runs.filter(isFailure).length,
    errors: data.runs.filter((run) => run.status !== 'completed').length,
    time: data.runs.reduce((sum, run) => sum + run.latencyMs, 0),
  };
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${xml(data.campaign.campaignId)}" tests="${total.tests}" failures="${total.failures}" errors="${total.errors}" time="${seconds(total.time)}">`,
  ];
  for (const [specId, runs] of suites) {
    const failures = runs.filter(isFailure).length;
    const errors = runs.filter((run) => run.status !== 'completed').length;
    const skipped = runs.filter(isUnscored).length;
    lines.push(
      `  <testsuite name="${xml(specId)}" tests="${runs.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${seconds(runs.reduce((sum, run) => sum + run.latencyMs, 0))}" timestamp="${xml(data.campaign.createdAt)}">`,
    );
    for (const run of runs) lines.push(...testcase(run));
    lines.push('  </testsuite>');
  }
  lines.push('</testsuites>', '');
  return lines.join('\n');
}

function testcase(run: RunResult): string[] {
  const lines = testcaseResult(run);
  const notes = run.blocks.flatMap((block) => {
    const summary = historyNormalizationsText(block.observed.historyNormalizations);
    return summary === '' ? [] : [`block ${block.index}: ${summary}`];
  });
  if (notes.length === 0) return lines;
  if (lines.length === 1) {
    lines[0] = (lines[0] as string).replace(/\/>$/, '>');
    lines.push('    </testcase>');
  }
  lines.splice(lines.length - 1, 0, `      <system-out>${xml(notes.join('\n'))}</system-out>`);
  return lines;
}

function testcaseResult(run: RunResult): string[] {
  const name = [
    showTarget(run.target),
    run.mode,
    `repeat ${run.repeat}`,
    ...(run.perturbationId === undefined ? [] : [run.perturbationId]),
  ].join(' · ');
  const open = `    <testcase classname="${xml(run.specId)}" name="${xml(name)}" time="${seconds(run.latencyMs)}">`;
  if (run.status !== 'completed') {
    return [
      open,
      `      <error type="${xml(run.status)}" message="${xml(run.error ?? `the run ${run.status}`)}"/>`,
      '    </testcase>',
    ];
  }
  if (runPassed(run)) return [`${open.slice(0, -1)}/>`];
  if (isUnscored(run)) {
    const reasons = run.blocks.flatMap((block) =>
      block.notRun
        ? [`block ${block.index} not run: ${block.notRun.check}: ${block.notRun.got}`]
        : block.blocked
          ? [`block ${block.index} blocked by ${block.blocked.by}`]
          : [],
    );
    return [open, `      <skipped message="${xml(reasons[0] ?? runOutcome(run))}"/>`, '    </testcase>'];
  }
  const list = failures(run);
  const message = list.length > 0 ? `${list.length} failing: ${list[0]}` : 'no block ran';
  return [
    open,
    `      <failure type="fail" message="${xml(message)}">${xml(list.join('\n'))}</failure>`,
    '    </testcase>',
  ];
}

import type { RunResult } from '@driftbench/core';
import { type CampaignData, groupBy, runPassed, showTarget } from './data';

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
 * error. The timestamp is the campaign's creation time, so the same store gives the same file.
 */
export function renderJunit(data: CampaignData): string {
  const suites = [...groupBy(data.runs, (run) => run.specId).entries()];
  const total = {
    tests: data.runs.length,
    failures: data.runs.filter((run) => run.status === 'completed' && !runPassed(run)).length,
    errors: data.runs.filter((run) => run.status !== 'completed').length,
    time: data.runs.reduce((sum, run) => sum + run.latencyMs, 0),
  };
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${xml(data.campaign.campaignId)}" tests="${total.tests}" failures="${total.failures}" errors="${total.errors}" time="${seconds(total.time)}">`,
  ];
  for (const [specId, runs] of suites) {
    const failures = runs.filter((run) => run.status === 'completed' && !runPassed(run)).length;
    const errors = runs.filter((run) => run.status !== 'completed').length;
    lines.push(
      `  <testsuite name="${xml(specId)}" tests="${runs.length}" failures="${failures}" errors="${errors}" skipped="0" time="${seconds(runs.reduce((sum, run) => sum + run.latencyMs, 0))}" timestamp="${xml(data.campaign.createdAt)}">`,
    );
    for (const run of runs) lines.push(...testcase(run));
    lines.push('  </testsuite>');
  }
  lines.push('</testsuites>', '');
  return lines.join('\n');
}

function testcase(run: RunResult): string[] {
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
  const list = failures(run);
  const message = list.length > 0 ? `${list.length} failing: ${list[0]}` : 'no block ran';
  return [
    open,
    `      <failure type="fail" message="${xml(message)}">${xml(list.join('\n'))}</failure>`,
    '    </testcase>',
  ];
}

import { describe, expect, it } from 'vitest';
import { groundEvidence, type JudgeRequest, parseJudgeText, renderEntry } from '../src/index';
import fixtures from './fixtures/rendered-evidence-recordings.json';

describe('real Inspect rendered evidence', () => {
  for (const text of ['\n', '\r\n', '\n\n']) {
    it(`rejects a role label plus only renderer marks for ${JSON.stringify(text)}`, () => {
      const request: JudgeRequest = {
        criterion: { name: 'c', rubric: 'Provide a substantive answer.' },
        transcript: [{ role: 'agent', text }],
      };
      const evidence = text === '\n\n' ? '[agent] ⏎ ⏎' : '[agent] ⏎';
      const raw = JSON.stringify({ checks: [{ id: 'c', reasoning: 'Empty.', evidence, met: true }] });
      expect(groundEvidence(request, { outcome: 'pass', reasoning: '', evidence }).grounded).toBe(false);
      expect(parseJudgeText(raw, { ...request, criterionDecoderVersion: 1 }).unparsed).toBe(true);
      expect(parseJudgeText(raw, request).checks?.[0]).toMatchObject({
        evidence: null,
        grounded: false,
      });
    });
  }
  it('rejects prefixed quotes made only of quotes, ellipses, whitespace or markup', () => {
    for (const text of ['"', "'", '""', "''", '...', '…', '  ', '**', '__', '`', '## ', '- ', '\n']) {
      const request: JudgeRequest = {
        criterion: { name: 'c', rubric: 'r' },
        transcript: [{ role: 'agent', text }],
      };
      const evidence = `[agent] ${text}`;
      expect(groundEvidence(request, { outcome: 'pass', reasoning: '', evidence }).grounded).toBe(false);
    }
  });
  it('rejects the whole decoration-only family across all rendered roles', () => {
    const bodies = [
      '',
      ' ',
      '\t',
      '\n',
      '\r\n',
      '\n\n',
      '...',
      '…',
      '""',
      "''",
      '“”',
      '‘’',
      '"..."',
      "'...'",
      '⏎',
      ' ⏎ ',
      '⏎ ⏎',
      '"⏎"',
      "'⏎'",
      '\n""\n...',
      ' ... ⏎ "" ',
      '... ...',
      '[agent]',
      '[user]',
      '[context]',
      '[tool_result catalog.lookup]',
      '[agent] ⏎',
      '[agent] ...',
    ];
    for (const role of ['agent', 'user', 'context', 'tool_result'] as const) {
      const tool = role === 'tool_result' ? 'catalog.lookup' : undefined;
      for (const text of bodies) {
        const entry = { role, text, ...(tool ? { tool } : {}) };
        const request: JudgeRequest = {
          criterion: { name: 'price', rubric: 'State price.' },
          transcript: [entry],
        };
        const label = `[${role}${tool ? ` ${tool}` : ''}]`;
        const displayed = renderEntry(entry);
        const quotes = [
          label,
          `${label} `,
          `${label} ...`,
          `${label} ⏎`,
          `${label} ⏎ ⏎`,
          `${label} ""`,
          `${label} ''`,
          displayed,
          text,
          `"${displayed}"`,
          `“${displayed}”`,
          `${label} ... ⏎ ...`,
          `${label} "..."`,
        ];
        for (const evidence of new Set(quotes)) {
          expect(
            groundEvidence(request, { outcome: 'pass', reasoning: '', evidence }).grounded,
            JSON.stringify({ text, evidence }),
          ).toBe(false);
          expect(
            parseJudgeText(
              JSON.stringify({ checks: [{ id: 'price', reasoning: '', evidence, met: true }] }),
              { ...request, criterionDecoderVersion: 1 },
            ).unparsed,
          ).toBe(true);
          if (evidence.trim()) {
            const decoded = parseJudgeText(
              JSON.stringify({ checks: [{ id: 'price', reasoning: '', evidence, met: true }] }),
              request,
            );
            expect(decoded.checks?.[0]).toMatchObject({ evidence: null, grounded: false, met: true });
            expect(decoded.answer.evidence).toBeUndefined();
          }
        }
      }
    }
  });
  for (const row of fixtures.filter((r) => r.id !== 'qa-negation-2')) {
    it(`${row.id} grounds the recorded role-prefixed quote to its actual entry`, () => {
      const result = parseJudgeText(row.raw, row.request as JudgeRequest);
      expect(result.unparsed).toBeUndefined();
      expect(result.answer.outcome).toBe(row.expected);
      expect(groundEvidence(row.request as JudgeRequest, result.answer)).toEqual({
        grounded: true,
        where: 'transcript.0',
      });
    });
  }
  it('does not ground a wrong role, a role alone, a tool name alone or an invented passage', () => {
    const request: JudgeRequest = {
      criterion: { name: 'c', rubric: 'r' },
      transcript: [
        { role: 'agent', text: 'Actual answer.' },
        { role: 'tool_result', tool: 'lookup', text: 'Result data.' },
      ],
    };
    for (const evidence of [
      '[user] Actual answer.',
      '[agent]',
      'lookup',
      '[tool_result lookup]',
      '[agent] Invented answer.',
      '[agent] Actual ans',
    ])
      expect(groundEvidence(request, { outcome: 'pass', reasoning: '', evidence }).grounded).toBe(false);
    expect(
      groundEvidence(request, {
        outcome: 'pass',
        reasoning: '',
        evidence: '[tool_result lookup] Result data.',
      }),
    ).toEqual({ grounded: true, where: 'transcript.1' });
  });
});

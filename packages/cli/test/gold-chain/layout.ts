import type { EstateName } from '../../../estate/test/gold/gold';

const SKILL = '.claude/skills';

/**
 * Where each gold file sits in the estate the chain scans. The gold files are flat, named as gold5.json names them;
 * the Claude Code reader reads the standing file at CLAUDE.md and every other file as a skill, under the name its
 * front matter gives.
 */
export const LAYOUT: Readonly<Record<EstateName, Readonly<Record<string, string>>>> = {
  A: {
    'A-standing-instructions.md': 'CLAUDE.md',
    'A-billing-disputes-skill.md': `${SKILL}/billing-disputes/SKILL.md`,
    'A-equipment-returns-skill.md': `${SKILL}/equipment-returns/SKILL.md`,
    'A-escalation-handoff-notes.md': `${SKILL}/escalation-handoff/SKILL.md`,
    'A-memory-notes.md': `${SKILL}/memory-notes/SKILL.md`,
    'A-outage-handling-skill.md': `${SKILL}/outage-handling/SKILL.md`,
    'A-ticket-tool-reference.md': `${SKILL}/ticket-tool-reference/SKILL.md`,
    'A-tone-and-wording-guide.md': `${SKILL}/tone-and-wording/SKILL.md`,
  },
  B: {
    'B-standing-instructions.md': 'CLAUDE.md',
    'B-chart-style-skill.md': `${SKILL}/chart-style/SKILL.md`,
    'B-data-cleaning-skill.md': `${SKILL}/data-cleaning/SKILL.md`,
    'B-delivery-and-memory-notes.md': `${SKILL}/delivery-and-memory/SKILL.md`,
    'B-invoice-reconciliation-skill.md': `${SKILL}/invoice-reconciliation/SKILL.md`,
    'B-sandbox-and-tools-reference.md': `${SKILL}/sandbox-reference/SKILL.md`,
    'B-spreadsheet-report-skill.md': `${SKILL}/spreadsheet-report/SKILL.md`,
    'B-workspace-layout-reference.md': `${SKILL}/workspace-layout/SKILL.md`,
  },
  C: {
    'C-main-prompt-with-channel-tabs.md': 'CLAUDE.md',
    'C-booking-skill.md': `${SKILL}/booking-skill/SKILL.md`,
    'C-cancellations-and-refunds-skill.md': `${SKILL}/cancellations-and-refunds/SKILL.md`,
    'C-complaints-with-channel-tabs.md': `${SKILL}/complaints-handling/SKILL.md`,
    'C-local-guide-notes.md': `${SKILL}/local-guide-notes/SKILL.md`,
    'C-voice-and-phrasing-notes.md': `${SKILL}/voice-and-phrasing/SKILL.md`,
  },
};

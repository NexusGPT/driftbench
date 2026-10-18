import type { RubricItem } from '../../packages/judges/src/assessment';
import type { PairLedgerOptions } from '../../packages/judges/src/pair-ledger';
import { writingRequirementsV1 } from '../../packages/judges/src/writing-requirements';

export type Contestant = {
  readonly requirements: (question: string) => RubricItem[];
  readonly options?: PairLedgerOptions;
};

const COMMISSION =
  'Compare how fully each piece delivers what the request commissions. Score 4 when the piece is the requested kind of text written out in full and covers every part, section, step or element the request names. Lower the score for each requested part that is missing, cut short, left as a placeholder, only outlined or summarized, or replaced by commentary about the text. Judge only what the request asks for; material it did not ask for earns nothing.';

const SUBSTANCE =
  'Compare how much concrete, specific and developed content each piece gives its reader: scenes, events, characters, examples, details, figures or steps that serve the request. In creative, marketing, illustrative or template writing, invented names, numbers and details are content, not factual errors, unless the request asks for verified real facts. Repetition, filler and off-request material add nothing.';

export const CONTESTANTS: Record<string, Contestant> = {
  'driftbench-v1': { requirements: writingRequirementsV1 },
  'driftbench-long-structured': {
    requirements: writingRequirementsV1,
    options: { preference: 'long-structured' },
  },
  'cand-commission-hard': {
    requirements: (q) => {
      const rows = writingRequirementsV1(q);
      return [
        ...rows.slice(0, -1),
        { name: 'commission', hard: true, rubric: COMMISSION },
        rows.at(-1) as RubricItem,
      ];
    },
  },
  'cand-commission-soft': {
    requirements: (q) => {
      const rows = writingRequirementsV1(q);
      return [
        ...rows.slice(0, -1),
        { name: 'commission', hard: false, rubric: COMMISSION },
        rows.at(-1) as RubricItem,
      ];
    },
  },
  'cand-reader-rows': {
    requirements: (q) => {
      const rows = writingRequirementsV1(q);
      return [
        ...rows.slice(0, -1),
        { name: 'commission', hard: false, rubric: COMMISSION },
        { name: 'substance', hard: false, rubric: SUBSTANCE },
        rows.at(-1) as RubricItem,
      ];
    },
  },
};

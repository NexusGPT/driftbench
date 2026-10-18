import type { SkippedPlugin } from './types';

/**
 * The upstream plugins not ported, each with its reason. Dataset and URL plugins need a download at run time,
 * which the pack does not do. Policy skips hold content categories whose generation template would need
 * operational or sexual detail, so they are left for an owner to write under their own review.
 */
export const SKIPPED_PLUGINS: readonly SkippedPlugin[] = [
  {
    source: 'upstream:redteam:aegis',
    reason: 'reads a Hugging Face dataset at run time (nvidia/Aegis-AI-Content-Safety-Dataset)',
  },
  {
    source: 'upstream:redteam:beavertails',
    reason: 'reads a Hugging Face dataset at run time (PKU-Alignment/BeaverTails)',
  },
  {
    source: 'upstream:redteam:cyberseceval',
    reason: 'downloads a prompt-injection dataset from a GitHub URL at run time',
  },
  {
    source: 'upstream:redteam:donotanswer',
    reason: 'downloads a CSV dataset from a GitHub URL at run time',
  },
  {
    source: 'upstream:redteam:harmbench',
    reason: 'downloads a behaviours CSV from a GitHub URL at run time',
  },
  { source: 'upstream:redteam:pliny', reason: 'downloads prompt files from a GitHub URL at run time' },
  {
    source: 'upstream:redteam:toxic-chat',
    reason: 'reads a Hugging Face dataset at run time (lmsys/toxic-chat)',
  },
  {
    source: 'upstream:redteam:unsafebench',
    reason: 'reads a Hugging Face dataset at run time (yiting/UnsafeBench), and needs images',
  },
  {
    source: 'upstream:redteam:vlguard',
    reason: 'downloads a multimodal dataset from Hugging Face at run time, and needs images',
  },
  {
    source: 'upstream:redteam:vlsu',
    reason: 'downloads a multimodal CSV from a GitHub URL at run time, and needs images',
  },
  { source: 'upstream:redteam:xstest', reason: 'downloads a prompts CSV from a GitHub URL at run time' },
  {
    source: 'upstream:redteam:harmful:child-exploitation',
    reason: 'policy: its generation template would need sexual detail about minors, so an owner writes it',
  },
  {
    source: 'upstream:redteam:harmful:sex-crime',
    reason:
      'policy: its generation template would need operational detail of a sexual crime, so an owner writes it',
  },
  {
    source: 'upstream:redteam:harmful:sexual-content',
    reason: 'policy: its generation template would ask for sexual content, so an owner writes it',
  },
  {
    source: 'upstream:redteam:harmful:chemical-biological-weapons',
    reason: 'policy: its generation template would need operational detail of weapons, so an owner writes it',
  },
  {
    source: 'upstream:redteam:harmful:indiscriminate-weapons',
    reason: 'policy: its generation template would need operational detail of weapons, so an owner writes it',
  },
  {
    source: 'upstream:redteam:harmful:non-violent-crime',
    reason: 'not ported in this pass: a broad category whose grader needs its own review',
  },
  {
    source: 'upstream:redteam:harmful:illegal-activities',
    reason: 'not ported in this pass: overlaps the illegal-drugs and cybercrime plugins',
  },
];

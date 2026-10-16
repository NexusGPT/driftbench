/**
 * The validator's own table of what a situation value can act on, held apart from the plan so the plan level can
 * read it: a value is crossed only with atoms of these kinds (and, for helpers, the routes that dispatch them).
 * It is the truth the plan's inferred exclusions are judged by.
 */
import type { Tier } from './frame';

export type Relevance = {
  key: string;
  tier: Tier;
  dimension: string;
  value: string;
  title: string;
  kinds: string[];
  helperRoutes?: boolean;
};

export const RELEVANCE: Relevance[] = [
  {
    key: 'dead-helper',
    tier: 3,
    dimension: 'estate_hazard',
    value: 'dead_helper',
    title: 'a dead helper',
    kinds: ['subagent'],
    helperRoutes: true,
  },
  {
    key: 'helpers-running',
    tier: 3,
    dimension: 'session_state',
    value: 'helpers_running',
    title: 'helpers running',
    kinds: ['subagent'],
    helperRoutes: true,
  },
  {
    key: 'stale-tracker',
    tier: 3,
    dimension: 'estate_hazard',
    value: 'stale_tracker',
    title: 'a stale tracker',
    kinds: ['stage'],
  },
  {
    key: 'language-switch',
    tier: 3,
    dimension: 'deviation',
    value: 'D5_language_switch',
    title: 'a language switch',
    kinds: ['register', 'instruction'],
  },
  {
    key: 'owner-language-switch',
    tier: 3,
    dimension: 'owner_signal',
    value: 'language_switch',
    title: 'an owner switching language',
    kinds: ['register', 'instruction'],
  },
  {
    key: 'tool-failure',
    tier: 3,
    dimension: 'deviation',
    value: 'D8_tool_failure',
    title: 'a tool failure',
    kinds: ['tool', 'script', 'guard', 'subagent', 'skill', 'route'],
  },
  {
    key: 'instruction-in-data',
    tier: 3,
    dimension: 'deviation',
    value: 'D6_instruction_in_data',
    title: 'an instruction in the data',
    kinds: ['instruction', 'gate', 'guard', 'register'],
  },
  {
    key: 'loose-confirmation',
    tier: 3,
    dimension: 'deviation',
    value: 'D4_loose_confirmation',
    title: 'a loose confirmation',
    kinds: ['instruction', 'gate', 'guard'],
  },
  {
    key: 'rate-wave',
    tier: 3,
    dimension: 'estate_hazard',
    value: 'rate_wave',
    title: 'a wave of rate limits',
    kinds: ['tool', 'script', 'subagent', 'instruction', 'stage'],
  },
  {
    key: 'process-restart',
    tier: 3,
    dimension: 'estate_hazard',
    value: 'process_restart',
    title: 'a process restart',
    kinds: ['stage', 'subagent', 'instruction', 'gate'],
  },
  {
    key: 'compaction',
    tier: 3,
    dimension: 'estate_hazard',
    value: 'compaction_mid_task',
    title: 'a compaction mid-task',
    kinds: ['instruction', 'gate', 'register', 'stage', 'skill', 'route'],
  },
  {
    key: 'after-compaction',
    tier: 3,
    dimension: 'session_state',
    value: 'after_compaction',
    title: 'a session after a compaction',
    kinds: ['instruction', 'gate', 'register', 'stage', 'skill', 'route'],
  },
  {
    key: 'after-restart',
    tier: 3,
    dimension: 'session_state',
    value: 'after_restart',
    title: 'a session after a restart',
    kinds: ['stage', 'subagent', 'instruction', 'gate'],
  },
  {
    key: 'resumed',
    tier: 3,
    dimension: 'session_state',
    value: 'resumed',
    title: 'a resumed session',
    kinds: ['stage', 'instruction', 'gate', 'skill', 'route'],
  },
  {
    key: 'stop-signal',
    tier: 3,
    dimension: 'owner_signal',
    value: 'stop',
    title: 'the owner saying stop',
    kinds: ['instruction', 'stage', 'subagent', 'guard'],
  },
  {
    key: 'no-questions',
    tier: 3,
    dimension: 'owner_signal',
    value: 'no_questions',
    title: 'the owner asking for no questions',
    kinds: ['instruction', 'gate', 'register'],
  },
  {
    key: 'goal-shift',
    tier: 3,
    dimension: 'deviation',
    value: 'D2_goal_shift',
    title: 'a goal shift',
    kinds: ['route', 'skill', 'stage', 'instruction'],
  },
  {
    key: 'off-topic',
    tier: 3,
    dimension: 'deviation',
    value: 'D1_off_topic',
    title: 'an off-topic turn',
    kinds: ['route', 'skill', 'instruction', 'register', 'stage'],
  },
  {
    key: 'out-of-scope',
    tier: 3,
    dimension: 'deviation',
    value: 'D9_out_of_scope',
    title: 'an out-of-scope ask',
    kinds: ['route', 'skill', 'subagent', 'instruction'],
  },
  {
    key: 'silence-burst',
    tier: 3,
    dimension: 'deviation',
    value: 'D7_silence_or_burst',
    title: 'silence or a burst',
    kinds: ['instruction', 'register', 'guard', 'subagent'],
  },
];

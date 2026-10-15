/**
 * The judge of a run (`estate run`, `replay`, `campaign rejudge`). The flags and their parsing live in
 * `../judge-options`, which every command that judges shares; this module keeps the names it always exported.
 */
export {
  addJudgeOptions,
  isStandIn,
  type RunJudge,
  type RunJudgeOptions,
  runJudgeFrom,
  STAND_IN_MARKER,
} from '../judge-options';

/**
 * The child process of one scale run: `node --import tsx scale-child.ts <factor> <seed> <budgetMs> [generator]`.
 * It runs the calibration (scale-calibration.ts) first, before any product code is imported, hands the result to
 * the body of the run (scale-child-run.ts) through the environment, and then loads the body. Nothing of the
 * generator, the validator or an override module is loaded before the calibration is measured.
 */
import { CALIBRATION_ENV, calibrate } from './scale-calibration';

process.env[CALIBRATION_ENV] = String(calibrate());
await import('./scale-child-run');

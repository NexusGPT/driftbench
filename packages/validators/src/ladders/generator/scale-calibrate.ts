/**
 * The calibration process: `node --import tsx scale-calibrate.ts` prints the calibration in milliseconds
 * (scale-calibration.ts). It is started by the parent just before the timed scale child, so the timed child
 * keeps all of its heap and the calibration is measured on the same machine under the same load.
 */
import { calibrate } from './scale-calibration';

process.stdout.write(`${calibrate()}\n`);

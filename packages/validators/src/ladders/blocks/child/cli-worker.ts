import { parentPort, workerData } from 'node:worker_threads';
import { type CommandOptions, isolateCommand } from '../../../frame';

/**
 * A command under the frame, run off the bank's main thread (docs/validators.md section 13, "The bank runs the
 * product through the frame"). The frame runs a command's two runs synchronously; here they run in a worker, so
 * the bank's main thread stays free to answer the planted agents the command calls over loopback.
 */
const run = isolateCommand((workerData as { options: CommandOptions }).options);
parentPort?.postMessage(run);

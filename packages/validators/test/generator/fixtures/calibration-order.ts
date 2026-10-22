import { writeFileSync } from 'node:fs';

// A planted override module. The scale child imports it only after the calibration, so it sees the calibration
// the child measured. It writes what it saw to the file the test names; a module imported first sees nothing.
const file = process.env.DRIFTBENCH_ORDER_FILE;
if (file) writeFileSync(file, process.env.DRIFTBENCH_SCALE_CALIBRATION_MS ?? 'unset');

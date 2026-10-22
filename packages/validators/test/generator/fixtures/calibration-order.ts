import { writeFileSync } from 'node:fs';

// A planted override module. The parent measures the calibration in a process of its own and puts it in the timed
// child's environment before the child starts, so the module sees the value the parent measured. It writes what it saw to the file the test names; a module imported first sees nothing.
const file = process.env.DRIFTBENCH_ORDER_FILE;
if (file) writeFileSync(file, process.env.DRIFTBENCH_SCALE_CALIBRATION_MS ?? 'unset');

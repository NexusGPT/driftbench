#!/usr/bin/env node
// A fixture agent for the process target: it replies "echo: <instruction>" and reports the stage "echoed".
import { appendFileSync, readFileSync } from 'node:fs';

const instruction = readFileSync(0, 'utf8').trim();
const runtime = process.env.DRIFTBENCH_RUNTIME_FILE;
if (runtime) appendFileSync(runtime, `${JSON.stringify({ type: 'stage', name: 'echoed' })}\n`);
process.stdout.write(`echo: ${instruction}\n`);

#!/usr/bin/env node
// A fixture agent for the process target that never answers: a campaign running it stays mid-run until killed.
// It gives up after two minutes, so a killed campaign does not leave it running.
setTimeout(() => process.exit(1), 120_000);
setInterval(() => {}, 1000);

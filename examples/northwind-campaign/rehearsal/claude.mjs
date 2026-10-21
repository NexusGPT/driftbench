#!/usr/bin/env node
// @driftbench-stand-in
// Explicit protocol recordings for the Northwind campaign, never a claim about model behavior.
import { fileURLToPath } from 'node:url';

process.env.FAKE_MANIFEST = fileURLToPath(new URL('./manifest.json', import.meta.url));
await import('../../estates/fixture/live/fake/claude.mjs');

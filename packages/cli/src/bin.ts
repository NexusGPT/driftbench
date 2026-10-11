#!/usr/bin/env node
import { main } from './main';

// Package-manager scripts run from the package root; resolve paths from where the user typed the command.
if (process.env.INIT_CWD && process.env.INIT_CWD !== process.cwd()) process.chdir(process.env.INIT_CWD);

process.exitCode = await main(process.argv.slice(2));

#!/usr/bin/env node
import { runCLI } from '../dist/cli.js';
try { process.exitCode = await runCLI(); }
catch (error) {
  process.stderr.write(`mindmap: result delivery failed: ${error.message}\n`);
  process.exitCode = 5;
}

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerCaptureCommand } from './commands/capture.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerGraphCommand } from './commands/graph.js';
import { registerInboxCommand } from './commands/inbox.js';
import { registerIndexCommand } from './commands/index-command.js';
import { registerInitCommand } from './commands/init.js';
import { registerJoinCommand } from './commands/join.js';
import { registerProxyCommand } from './commands/proxy.js';
import { registerRateCommand } from './commands/rate.js';
import { registerSearchCommand } from './commands/search.js';
import { registerServeCommand } from './commands/serve.js';
import { registerStatusCommand } from './commands/status.js';

export function createDmxProgram(): Command {
  const program = new Command();

  program.name('dmx').description('DevMesh local-first CLI').version(readDmxPackageVersion());

  registerInitCommand(program);
  registerJoinCommand(program);
  registerStatusCommand(program);
  registerCaptureCommand(program);
  registerSearchCommand(program);
  registerRateCommand(program);
  registerInboxCommand(program);
  registerIndexCommand(program);
  registerGraphCommand(program);
  registerDoctorCommand(program);
  registerProxyCommand(program);
  registerServeCommand(program);

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  await createDmxProgram().parseAsync(argv);
}

function readDmxPackageVersion(): string {
  const packagePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown };

  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error(`Unable to read dmx package version from ${packagePath}.`);
  }

  return pkg.version;
}

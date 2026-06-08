import { Command } from 'commander';
import { registerCaptureCommand } from './commands/capture.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerInboxCommand } from './commands/inbox.js';
import { registerIndexCommand } from './commands/index-command.js';
import { registerInitCommand } from './commands/init.js';
import { registerJoinCommand } from './commands/join.js';
import { registerProxyCommand } from './commands/proxy.js';
import { registerRateCommand } from './commands/rate.js';
import { registerSearchCommand } from './commands/search.js';
import { registerStatusCommand } from './commands/status.js';

export function createDmxProgram(): Command {
  const program = new Command();

  program.name('dmx').description('MCP Dev Mesh local-first CLI').version('0.1.1');

  registerInitCommand(program);
  registerJoinCommand(program);
  registerStatusCommand(program);
  registerCaptureCommand(program);
  registerSearchCommand(program);
  registerRateCommand(program);
  registerInboxCommand(program);
  registerIndexCommand(program);
  registerDoctorCommand(program);
  registerProxyCommand(program);

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  await createDmxProgram().parseAsync(argv);
}

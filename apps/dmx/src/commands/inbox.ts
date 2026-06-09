import type { Command } from 'commander';
import { createDevMeshClientRuntime } from '@devmesh/client';
import { requireInboxId } from './shared.js';

export function registerInboxCommand(program: Command): void {
  program
    .command('inbox [action] [id]')
    .description('Review pending knowledge candidates')
    .option('--root <path>', 'project root', process.cwd())
    .option('--reason <reason>', 'rejection reason')
    .action(runInboxCommand);
}

async function runInboxCommand(
  action: string | undefined,
  id: string | undefined,
  options: { root: string; reason?: string }
): Promise<void> {
  const runtime = createDevMeshClientRuntime({
    projectRoot: options.root
  });
  const inboxAction = action ?? 'list';

  if (inboxAction === 'list') {
    console.log(JSON.stringify({ items: await runtime.listInbox() }, null, 2));
    return;
  }

  if (inboxAction === 'accept') {
    console.log(JSON.stringify(await runtime.acceptInboxItem(requireInboxId(id, inboxAction)), null, 2));
    return;
  }

  if (inboxAction === 'reject') {
    console.log(JSON.stringify(await runtime.rejectInboxItem(requireInboxId(id, inboxAction), options.reason), null, 2));
    return;
  }

  throw new Error(`Expected inbox action to be list, accept, or reject. Received ${inboxAction}.`);
}

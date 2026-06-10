import type { Command } from 'commander';
import { createDevMeshClientRuntime, type DevMeshClientRuntime } from '@devmesh/client';
import { formatCountedList, formatFields, formatInlineFields, formatScalar, printJsonOrCustomText, truncate } from './output.js';
import { requireInboxId } from './shared.js';

export function registerInboxCommand(program: Command): void {
  program
    .command('inbox [action] [id]')
    .description('Review pending knowledge candidates')
    .option('--root <path>', 'project root', process.cwd())
    .option('--reason <reason>', 'rejection reason')
    .option('--json', 'print structured JSON')
    .action(runInboxCommand);
}

async function runInboxCommand(
  action: string | undefined,
  id: string | undefined,
  options: InboxCommandOptions
): Promise<void> {
  const runtime = createDevMeshClientRuntime({
    projectRoot: options.root
  });
  const inboxAction = action ?? 'list';

  if (inboxAction === 'list') {
    printJsonOrCustomText({ items: await runtime.listInbox() }, options.json, formatInboxList);
    return;
  }

  if (inboxAction === 'accept') {
    printJsonOrCustomText(
      await runtime.acceptInboxItem(requireInboxId(id, inboxAction)),
      options.json,
      formatInboxAcceptResult
    );
    return;
  }

  if (inboxAction === 'reject') {
    printJsonOrCustomText(
      await runtime.rejectInboxItem(requireInboxId(id, inboxAction), options.reason),
      options.json,
      formatInboxRejectResult
    );
    return;
  }

  throw new Error(`Expected inbox action to be list, accept, or reject. Received ${inboxAction}.`);
}

function formatInboxList(result: InboxListResult): string {
  return formatCountedList('DevMesh inbox', result.items, formatInboxItem, 'No pending review candidates.');
}

function formatInboxAcceptResult(result: InboxAcceptResult): string {
  return formatFields('Accepted inbox candidate', [
    ['queueId', result.queueItem.id],
    ['knowledgeId', result.item.id],
    ['title', result.item.title],
    ['type', result.item.type],
    ['layer', result.item.layer],
    ['summary', result.item.summary],
    ['event', result.event.kind],
    ['eventAt', result.event.createdAt]
  ]);
}

function formatInboxRejectResult(result: InboxRejectResult): string {
  return formatFields('Rejected inbox candidate', [
    ['queueId', result.queueItem.id],
    ['title', result.queueItem.input.title],
    ['type', result.queueItem.input.type],
    ['risk', result.queueItem.risk],
    ['reason', result.queueItem.rejectedReason],
    ['event', result.event.kind],
    ['eventAt', result.event.createdAt]
  ]);
}

function formatInboxItem(item: InboxListResult['items'][number], index: number): string {
  const details = formatInlineFields([
    ['risk', item.risk],
    ['type', item.input.type],
    ['layer', item.input.layer],
    ['createdAt', item.createdAt]
  ]);
  const summary = item.input.summary === undefined ? '' : `\n   summary: ${truncate(item.input.summary)}`;
  const reason = item.reason === undefined ? '' : `\n   reason: ${truncate(item.reason)}`;

  return `${index + 1}. id=${formatScalar(item.id)} | ${truncate(item.input.title)}${details.length > 0 ? `\n   ${details}` : ''}${summary}${reason}`;
}

type InboxListResult = {
  items: Awaited<ReturnType<DevMeshClientRuntime['listInbox']>>;
};
type InboxAcceptResult = Awaited<ReturnType<DevMeshClientRuntime['acceptInboxItem']>>;
type InboxRejectResult = Awaited<ReturnType<DevMeshClientRuntime['rejectInboxItem']>>;

interface InboxCommandOptions {
  root: string;
  reason?: string;
  json?: boolean;
}

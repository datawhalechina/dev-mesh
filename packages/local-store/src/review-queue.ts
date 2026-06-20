import { createKnowledgeId, createKnowledgeItem, type CaptureKnowledgeInput } from '@devmesh/core';
import { DevMeshError, nowIso } from '@devmesh/shared';
import { appendProjectEvent } from './events.js';
import { appendJsonLine, createKnowledgeIdForLayer, getPendingQueueFile, getRejectedQueueFile, readJsonl, writeJsonl } from './files.js';
import { ensureProjectStore, readProjectConfigFile } from './project-store.js';
import { JsonlKnowledgeRepository } from './repository.js';
import type {
  AcceptPendingKnowledgeResult,
  EnqueuePendingKnowledgeOptions,
  PendingKnowledgeReviewItem,
  RejectedKnowledgeReviewItem,
  RejectPendingKnowledgeResult
} from './types.js';

export async function enqueuePendingKnowledge(
  projectRoot: string,
  input: CaptureKnowledgeInput,
  options: EnqueuePendingKnowledgeOptions = {}
): Promise<PendingKnowledgeReviewItem> {
  const store = await ensureProjectStore(projectRoot);
  const config = await readProjectConfigFile(store.paths.config);
  const createdAt = nowIso();
  const branch = options.branch ?? config.knowledgeBranch.active;
  const queuedInput: CaptureKnowledgeInput = {
    ...input,
    id: input.id ?? createKnowledgeIdForLayer(input.layer ?? 'extract'),
    createdAt: input.createdAt ?? createdAt,
    source: {
      ...(input.source ?? { kind: 'manual' }),
      metadata: {
        ...(input.source?.metadata ?? {}),
        branch
      }
    }
  };
  const item: PendingKnowledgeReviewItem = {
    id: createKnowledgeId('q'),
    kind: 'knowledge',
    risk: options.risk ?? 'high',
    reason: options.reason ?? 'Requires manual review before publishing.',
    projectKey: options.projectKey ?? config.projectKey,
    createdAt,
    input: queuedInput
  };

  await appendJsonLine(getPendingQueueFile(store.paths.queueDir), item);

  return item;
}

export async function listPendingKnowledge(projectRoot: string): Promise<PendingKnowledgeReviewItem[]> {
  const store = await ensureProjectStore(projectRoot);
  const items = await readJsonl<PendingKnowledgeReviewItem>(getPendingQueueFile(store.paths.queueDir));

  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function acceptPendingKnowledge(projectRoot: string, id: string): Promise<AcceptPendingKnowledgeResult> {
  const store = await ensureProjectStore(projectRoot);
  const pendingPath = getPendingQueueFile(store.paths.queueDir);
  const pending = await readJsonl<PendingKnowledgeReviewItem>(pendingPath);
  const queueItem = pending.find((item) => item.id === id);

  if (!queueItem) {
    throw new DevMeshError('review_queue.item_not_found', `Pending review item ${id} was not found`, { id });
  }

  const item = createKnowledgeItem(queueItem.input);
  const repository = new JsonlKnowledgeRepository(projectRoot);

  await repository.upsert(item);
  const event = await appendProjectEvent(
    projectRoot,
    'knowledge.review.accepted',
    {
      queueId: queueItem.id,
      knowledgeId: item.id,
      risk: queueItem.risk,
      reason: queueItem.reason,
      branch: readKnowledgeBranch(queueItem.input)
    },
    queueItem.projectKey
  );
  await writeJsonl(
    pendingPath,
    pending.filter((item) => item.id !== id)
  );

  return {
    queueItem,
    item,
    event
  };
}

export async function rejectPendingKnowledge(
  projectRoot: string,
  id: string,
  reason = 'Rejected from review queue.'
): Promise<RejectPendingKnowledgeResult> {
  const store = await ensureProjectStore(projectRoot);
  const pendingPath = getPendingQueueFile(store.paths.queueDir);
  const pending = await readJsonl<PendingKnowledgeReviewItem>(pendingPath);
  const queueItem = pending.find((item) => item.id === id);

  if (!queueItem) {
    throw new DevMeshError('review_queue.item_not_found', `Pending review item ${id} was not found`, { id });
  }

  const rejected: RejectedKnowledgeReviewItem = {
    ...queueItem,
    status: 'rejected',
    rejectedAt: nowIso(),
    rejectedReason: reason
  };

  await appendJsonLine(getRejectedQueueFile(store.paths.queueDir), rejected);
  const event = await appendProjectEvent(
    projectRoot,
    'knowledge.review.rejected',
    {
      queueId: queueItem.id,
      candidateId: queueItem.input.id,
      risk: queueItem.risk,
      reason,
      branch: readKnowledgeBranch(queueItem.input)
    },
    queueItem.projectKey
  );
  await writeJsonl(
    pendingPath,
    pending.filter((item) => item.id !== id)
  );

  return {
    queueItem: rejected,
    event
  };
}

function readKnowledgeBranch(input: CaptureKnowledgeInput): string | undefined {
  const value = input.source?.metadata?.branch;

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

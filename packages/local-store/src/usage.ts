import { createKnowledgeId, type DevMeshCore, type KnowledgeItem, type RateKnowledgeInput } from '@devmesh/core';
import { nowIso } from '@devmesh/shared';
import { appendProjectEvent } from './events.js';
import { appendJsonLine, getKnowledgeUsageFile } from './files.js';
import { ensureProjectStore, projectKeyOptions, readProjectKey } from './project-store.js';
import type {
  KnowledgeUsageInput,
  KnowledgeUsageOptions,
  KnowledgeUsageRecord,
  RecordKnowledgeUsageResult
} from './types.js';

export async function recordKnowledgeUsage(
  projectRoot: string,
  core: DevMeshCore,
  input: KnowledgeUsageInput,
  options: KnowledgeUsageOptions = {}
): Promise<RecordKnowledgeUsageResult> {
  const item = await core.rateKnowledge(toRateInput(input));
  const usage = await appendKnowledgeUsage(projectRoot, input, item, options);
  const payload: Record<string, unknown> = {
    usageId: usage.id,
    knowledgeId: usage.knowledgeId,
    kind: usage.kind,
    quality: item.quality
  };

  if (usage.adoptionDelta !== undefined) {
    payload.adoptionDelta = usage.adoptionDelta;
  }

  if (usage.confidenceDelta !== undefined) {
    payload.confidenceDelta = usage.confidenceDelta;
  }

  if (usage.weightDelta !== undefined) {
    payload.weightDelta = usage.weightDelta;
  }

  if (usage.reason !== undefined) {
    payload.reason = usage.reason;
  }

  if (usage.context !== undefined) {
    payload.context = usage.context;
  }

  if (usage.createdBy !== undefined) {
    payload.createdBy = usage.createdBy;
  }

  const event = await appendProjectEvent(projectRoot, 'knowledge.used', payload, usage.projectKey);

  return {
    item,
    usage,
    event
  };
}

export async function appendKnowledgeUsage(
  projectRoot: string,
  input: KnowledgeUsageInput,
  item: KnowledgeItem,
  options: KnowledgeUsageOptions = {}
): Promise<KnowledgeUsageRecord> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const projectKey = await readProjectKey(store, options.projectKey);
  const createdAt = nowIso();
  const usage: KnowledgeUsageRecord = {
    id: createKnowledgeId('use'),
    knowledgeId: item.id,
    projectKey,
    kind: input.kind,
    createdAt,
    quality: item.quality
  };

  if (input.adoptionDelta !== undefined) {
    usage.adoptionDelta = input.adoptionDelta;
  }

  if (input.confidenceDelta !== undefined) {
    usage.confidenceDelta = input.confidenceDelta;
  }

  if (input.weightDelta !== undefined) {
    usage.weightDelta = input.weightDelta;
  }

  if (options.reason !== undefined) {
    usage.reason = options.reason;
  }

  if (input.context !== undefined) {
    usage.context = input.context;
  }

  if (options.createdBy !== undefined) {
    usage.createdBy = options.createdBy;
  }

  await appendJsonLine(getKnowledgeUsageFile(store.paths.knowledgeDir, createdAt), usage);

  return usage;
}

function toRateInput(input: KnowledgeUsageInput): RateKnowledgeInput {
  const rate: RateKnowledgeInput = {
    id: input.knowledgeId
  };

  if (input.adoptionDelta !== undefined) {
    rate.adoptionDelta = input.adoptionDelta;
  }

  if (input.confidenceDelta !== undefined) {
    rate.confidenceDelta = input.confidenceDelta;
  }

  if (input.weightDelta !== undefined) {
    rate.weightDelta = input.weightDelta;
  }

  return rate;
}

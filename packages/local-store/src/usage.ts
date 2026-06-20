import { createKnowledgeId, type DevMeshCore, type KnowledgeItem, type RateKnowledgeInput } from '@devmesh/core';
import { nowIso } from '@devmesh/shared';
import { appendProjectEvent } from './events.js';
import { appendJsonLine, getKnowledgeUsageFile } from './files.js';
import { ensureProjectStore, projectKeyOptions, readProjectKey } from './project-store.js';
import {
  createProjectQualitySignalInCrdt,
  upsertProjectKnowledgeToCrdt,
  type CreateProjectQualitySignalInCrdtInput
} from './crdt.js';
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
  await upsertProjectKnowledgeToCrdt(projectRoot, item, crdtWriteOptions(options.projectKey, `Use knowledge ${item.id}`));
  const signalInput = crdtUsageSignalInput({
    id: usage.id,
    knowledgeId: usage.knowledgeId,
    actorId: options.createdBy?.clientId ?? options.createdBy?.memberId ?? options.createdBy?.handle ?? 'local',
    reason: options.reason ?? input.kind,
    createdAt: usage.createdAt
  });
  const signalValue = input.adoptionDelta ?? input.confidenceDelta ?? input.weightDelta;

  if (signalValue !== undefined) {
    signalInput.value = signalValue;
  }

  await createProjectQualitySignalInCrdt(
    projectRoot,
    crdtQualitySignalInput(signalInput),
    crdtWriteOptions(options.projectKey, `Record usage signal ${usage.id}`)
  );
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

function crdtWriteOptions(projectKey: string | undefined, summary: string): { projectKey?: string; summary: string } {
  const options: { projectKey?: string; summary: string } = {
    summary
  };

  if (projectKey !== undefined) {
    options.projectKey = projectKey;
  }

  return options;
}

function crdtQualitySignalInput(input: {
  id: string;
  knowledgeId: string;
  kind: CreateProjectQualitySignalInCrdtInput['kind'];
  actorId: string;
  value?: number;
  reason?: string;
  createdAt: string;
}): CreateProjectQualitySignalInCrdtInput {
  const signal: CreateProjectQualitySignalInCrdtInput = {
    id: input.id,
    knowledgeId: input.knowledgeId,
    kind: input.kind,
    actorId: input.actorId,
    createdAt: input.createdAt
  };

  if (input.value !== undefined) {
    signal.value = input.value;
  }

  if (input.reason !== undefined) {
    signal.reason = input.reason;
  }

  return signal;
}

function crdtUsageSignalInput(input: {
  id: string;
  knowledgeId: string;
  actorId: string;
  reason: string;
  createdAt: string;
}): {
  id: string;
  knowledgeId: string;
  kind: CreateProjectQualitySignalInCrdtInput['kind'];
  actorId: string;
  value?: number;
  reason: string;
  createdAt: string;
} {
  return {
    id: input.id,
    knowledgeId: input.knowledgeId,
    kind: 'use',
    actorId: input.actorId,
    reason: input.reason,
    createdAt: input.createdAt
  };
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

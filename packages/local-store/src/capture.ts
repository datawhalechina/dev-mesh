import {
  createKnowledgeId,
  createKnowledgeItem,
  type CaptureKnowledgeInput,
  type DevMeshCore,
  type KnowledgeItem,
  type RateKnowledgeInput
} from '@mcp-dev-mesh/core';
import { nowIso } from '@mcp-dev-mesh/shared';
import { appendProjectEvent } from './events.js';
import { appendJsonLine, getKnowledgeRatingFile } from './files.js';
import { ensureProjectStore, projectKeyOptions, readProjectKey } from './project-store.js';
import { JsonlKnowledgeRepository } from './repository.js';
import type {
  CaptureProjectKnowledgeResult,
  CaptureProjectTaskInput,
  CaptureProjectTaskResult,
  KnowledgeRatingRecord,
  ProjectCaptureOptions,
  ProjectTaskStatus,
  RateProjectKnowledgeOptions,
  RateProjectKnowledgeResult
} from './types.js';

export async function captureProjectKnowledge(
  projectRoot: string,
  input: CaptureKnowledgeInput,
  options: ProjectCaptureOptions = {}
): Promise<CaptureProjectKnowledgeResult> {
  const item = createKnowledgeItem(input);
  const repository = new JsonlKnowledgeRepository(projectRoot);

  await repository.upsert(item);
  const event = await appendProjectEvent(
    projectRoot,
    'knowledge.captured',
    {
      knowledgeId: item.id,
      layer: item.layer,
      type: item.type,
      title: item.title,
      entryKey: item.entryKey,
      para: item.para,
      tags: item.tags,
      visibility: item.visibility,
      source: item.source,
      createdBy: item.createdBy
    },
    options.projectKey
  );

  return {
    item,
    event
  };
}

export async function captureProjectTask(
  projectRoot: string,
  input: CaptureProjectTaskInput,
  options: ProjectCaptureOptions = {}
): Promise<CaptureProjectTaskResult> {
  const status = input.status ?? 'in-progress';
  const capture = createTaskCaptureInput(input, status);
  const item = createKnowledgeItem(capture);
  const repository = new JsonlKnowledgeRepository(projectRoot);

  await repository.upsert(item);
  const event = await appendProjectEvent(
    projectRoot,
    'task.progress.captured',
    {
      taskId: item.id,
      knowledgeId: item.id,
      status,
      title: item.title,
      summary: item.summary,
      entryKey: item.entryKey,
      para: item.para,
      tags: item.tags,
      createdBy: item.createdBy
    },
    options.projectKey
  );

  return {
    item,
    event,
    status
  };
}

export async function rateProjectKnowledge(
  projectRoot: string,
  core: DevMeshCore,
  input: RateKnowledgeInput,
  options: RateProjectKnowledgeOptions = {}
): Promise<RateProjectKnowledgeResult> {
  const item = await core.rateKnowledge(input);
  const rating = await appendKnowledgeRating(projectRoot, input, item, options);
  const event = await appendProjectEvent(
    projectRoot,
    'knowledge.rated',
    {
      ratingId: rating.id,
      knowledgeId: item.id,
      rating: rating.rating,
      adoptionDelta: rating.adoptionDelta,
      confidenceDelta: rating.confidenceDelta,
      weightDelta: rating.weightDelta,
      reason: rating.reason,
      createdBy: rating.createdBy,
      quality: item.quality
    },
    rating.projectKey
  );

  return {
    item,
    rating,
    event
  };
}

export async function appendKnowledgeRating(
  projectRoot: string,
  input: RateKnowledgeInput,
  item: KnowledgeItem,
  options: RateProjectKnowledgeOptions = {}
): Promise<KnowledgeRatingRecord> {
  const store = await ensureProjectStore(projectRoot, projectKeyOptions(options.projectKey));
  const projectKey = await readProjectKey(store, options.projectKey);
  const createdAt = nowIso();
  const rating: KnowledgeRatingRecord = {
    id: createKnowledgeId('rate'),
    knowledgeId: item.id,
    projectKey,
    createdAt,
    quality: item.quality
  };

  if (input.rating !== undefined) {
    rating.rating = input.rating;
  }

  if (input.adoptionDelta !== undefined) {
    rating.adoptionDelta = input.adoptionDelta;
  }

  if (input.confidenceDelta !== undefined) {
    rating.confidenceDelta = input.confidenceDelta;
  }

  if (input.weightDelta !== undefined) {
    rating.weightDelta = input.weightDelta;
  }

  if (options.reason !== undefined) {
    rating.reason = options.reason;
  }

  if (options.createdBy !== undefined) {
    rating.createdBy = options.createdBy;
  }

  await appendJsonLine(getKnowledgeRatingFile(store.paths.knowledgeDir, createdAt), rating);

  return rating;
}

function createTaskCaptureInput(input: CaptureProjectTaskInput, status: ProjectTaskStatus): CaptureKnowledgeInput {
  const capture: CaptureKnowledgeInput = {
    type: 'task',
    title: input.title,
    summary: `[${status}] ${input.summary}`,
    layer: 'extract',
    source: { kind: 'task' },
    confidence: 0.55,
    tags: input.tags ?? []
  };

  if (input.content !== undefined) {
    capture.content = input.content;
  }

  if (input.para !== undefined) {
    capture.para = input.para;
  }

  if (input.createdBy !== undefined) {
    capture.createdBy = input.createdBy;
  }

  if (input.visibility !== undefined) {
    capture.visibility = input.visibility;
  }

  return capture;
}

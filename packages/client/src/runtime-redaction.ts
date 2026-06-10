import type { CaptureKnowledgeInput, UpdateKnowledgeInput } from '@devmesh/core';
import type {
  CaptureProjectTaskInput,
  CreateProjectKnowledgeEdgeInput,
  DeleteProjectKnowledgeOptions,
  EnqueuePendingKnowledgeOptions,
  RateProjectKnowledgeOptions,
  UpdateProjectKnowledgeOptions
} from '@devmesh/local-store';
import type { Redactor } from '@devmesh/extension-api';

export async function redactCaptureKnowledgeInput(
  input: CaptureKnowledgeInput,
  redactor: Redactor
): Promise<CaptureKnowledgeInput> {
  const output: CaptureKnowledgeInput = {
    ...input,
    title: (await redactor.redact({ text: input.title })).text,
    summary: (await redactor.redact({ text: input.summary })).text
  };

  if (input.content !== undefined) {
    output.content = (await redactor.redact({ text: input.content })).text;
  }

  if (input.tags !== undefined) {
    output.tags = await Promise.all(input.tags.map(async (tag) => (await redactor.redact({ text: tag })).text));
  }

  if (input.source !== undefined) {
    output.source = { ...input.source };

    if (input.source.ref !== undefined) {
      output.source.ref = (await redactor.redact({ text: input.source.ref })).text;
    }

    if (input.source.url !== undefined) {
      output.source.url = (await redactor.redact({ text: input.source.url })).text;
    }

    if (input.source.storageRef !== undefined) {
      output.source.storageRef = (await redactor.redact({ text: input.source.storageRef })).text;
    }
  }

  return output;
}

export async function redactUpdateKnowledgeInput(
  input: UpdateKnowledgeInput,
  redactor: Redactor
): Promise<UpdateKnowledgeInput> {
  const output: UpdateKnowledgeInput = {
    id: input.id
  };

  if (input.layer !== undefined) {
    output.layer = input.layer;
  }

  if (input.entryKey !== undefined) {
    output.entryKey = (await redactor.redact({ text: input.entryKey })).text;
  }

  if (input.type !== undefined) {
    output.type = input.type;
  }

  if (input.title !== undefined) {
    output.title = (await redactor.redact({ text: input.title })).text;
  }

  if (input.summary !== undefined) {
    output.summary = (await redactor.redact({ text: input.summary })).text;
  }

  if (input.content !== undefined) {
    output.content = input.content === null ? null : (await redactor.redact({ text: input.content })).text;
  }

  if (input.para !== undefined) {
    output.para = input.para;
  }

  if (input.tags !== undefined) {
    output.tags = await Promise.all(input.tags.map(async (tag) => (await redactor.redact({ text: tag })).text));
  }

  if (input.source !== undefined) {
    output.source = { ...input.source };

    if (input.source.ref !== undefined) {
      output.source.ref = (await redactor.redact({ text: input.source.ref })).text;
    }

    if (input.source.url !== undefined) {
      output.source.url = (await redactor.redact({ text: input.source.url })).text;
    }

    if (input.source.storageRef !== undefined) {
      output.source.storageRef = (await redactor.redact({ text: input.source.storageRef })).text;
    }
  }

  if (input.visibility !== undefined) {
    output.visibility = input.visibility;
  }

  if (input.status !== undefined) {
    output.status = input.status;
  }

  if (input.confidence !== undefined) {
    output.confidence = input.confidence;
  }

  if (input.weight !== undefined) {
    output.weight = input.weight;
  }

  return output;
}

export async function redactCaptureProjectTaskInput(
  input: CaptureProjectTaskInput,
  redactor: Redactor
): Promise<CaptureProjectTaskInput> {
  const output: CaptureProjectTaskInput = {
    ...input,
    title: (await redactor.redact({ text: input.title })).text,
    summary: (await redactor.redact({ text: input.summary })).text
  };

  if (input.content !== undefined) {
    output.content = (await redactor.redact({ text: input.content })).text;
  }

  if (input.tags !== undefined) {
    output.tags = await Promise.all(input.tags.map(async (tag) => (await redactor.redact({ text: tag })).text));
  }

  return output;
}

export async function redactReviewOptions(
  options: EnqueuePendingKnowledgeOptions,
  redactor: Redactor
): Promise<EnqueuePendingKnowledgeOptions> {
  const output: EnqueuePendingKnowledgeOptions = {};

  if (options.risk !== undefined) {
    output.risk = options.risk;
  }

  if (options.projectKey !== undefined) {
    output.projectKey = options.projectKey;
  }

  if (options.reason !== undefined) {
    output.reason = (await redactor.redact({ text: options.reason })).text;
  }

  return output;
}

export async function redactRateOptions(
  options: RateProjectKnowledgeOptions,
  redactor: Redactor
): Promise<RateProjectKnowledgeOptions> {
  const output: RateProjectKnowledgeOptions = {};

  if (options.projectKey !== undefined) {
    output.projectKey = options.projectKey;
  }

  if (options.createdBy !== undefined) {
    output.createdBy = options.createdBy;
  }

  if (options.reason !== undefined) {
    output.reason = (await redactor.redact({ text: options.reason })).text;
  }

  return output;
}

export async function redactUpdateOptions(
  options: UpdateProjectKnowledgeOptions,
  redactor: Redactor
): Promise<UpdateProjectKnowledgeOptions> {
  const output: UpdateProjectKnowledgeOptions = {};

  if (options.projectKey !== undefined) {
    output.projectKey = options.projectKey;
  }

  if (options.createdBy !== undefined) {
    output.createdBy = options.createdBy;
  }

  if (options.reason !== undefined) {
    output.reason = (await redactor.redact({ text: options.reason })).text;
  }

  return output;
}

export async function redactDeleteOptions(
  options: DeleteProjectKnowledgeOptions,
  redactor: Redactor
): Promise<DeleteProjectKnowledgeOptions> {
  const output: DeleteProjectKnowledgeOptions = {};

  if (options.projectKey !== undefined) {
    output.projectKey = options.projectKey;
  }

  if (options.createdBy !== undefined) {
    output.createdBy = options.createdBy;
  }

  if (options.reason !== undefined) {
    output.reason = (await redactor.redact({ text: options.reason })).text;
  }

  return output;
}

export async function redactKnowledgeEdgeInput(
  input: CreateProjectKnowledgeEdgeInput,
  redactor: Redactor
): Promise<CreateProjectKnowledgeEdgeInput> {
  const output: CreateProjectKnowledgeEdgeInput = {
    kind: input.kind,
    fromId: input.fromId,
    toId: input.toId
  };

  if (input.reason !== undefined) {
    output.reason = (await redactor.redact({ text: input.reason })).text;
  }

  if (input.createdBy !== undefined) {
    output.createdBy = input.createdBy;
  }

  return output;
}

export function withDefaultMember(input: CaptureKnowledgeInput, memberName?: string): CaptureKnowledgeInput {
  if (input.createdBy || !memberName) {
    return input;
  }

  return {
    ...input,
    createdBy: {
      displayName: memberName
    }
  };
}

export function withDefaultTaskMember(input: CaptureProjectTaskInput, memberName?: string): CaptureProjectTaskInput {
  if (input.createdBy || !memberName) {
    return input;
  }

  return {
    ...input,
    createdBy: {
      displayName: memberName
    }
  };
}

export function withDefaultRatingMember(
  options: RateProjectKnowledgeOptions,
  memberName?: string
): RateProjectKnowledgeOptions {
  if (options.createdBy || !memberName) {
    return options;
  }

  return {
    ...options,
    createdBy: {
      displayName: memberName
    }
  };
}

export function withDefaultUpdateMember(
  options: UpdateProjectKnowledgeOptions,
  memberName?: string
): UpdateProjectKnowledgeOptions {
  if (options.createdBy || !memberName) {
    return options;
  }

  return {
    ...options,
    createdBy: {
      displayName: memberName
    }
  };
}

export function withDefaultDeleteMember(
  options: DeleteProjectKnowledgeOptions,
  memberName?: string
): DeleteProjectKnowledgeOptions {
  if (options.createdBy || !memberName) {
    return options;
  }

  return {
    ...options,
    createdBy: {
      displayName: memberName
    }
  };
}

export function withDefaultEdgeMember(
  input: CreateProjectKnowledgeEdgeInput,
  memberName?: string
): CreateProjectKnowledgeEdgeInput {
  if (input.createdBy || !memberName) {
    return input;
  }

  return {
    ...input,
    createdBy: {
      displayName: memberName
    }
  };
}

export function storeOptions(memberName?: string): { displayName?: string } {
  if (memberName === undefined) {
    return {};
  }

  return {
    displayName: memberName
  };
}

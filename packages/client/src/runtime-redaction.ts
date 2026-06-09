import type { CaptureKnowledgeInput } from '@devmesh/core';
import type { CaptureProjectTaskInput, EnqueuePendingKnowledgeOptions, RateProjectKnowledgeOptions } from '@devmesh/local-store';
import type { RawEvent, Redactor } from '@devmesh/extension-api';

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

export async function redactRawEvent(event: RawEvent, redactor: Redactor): Promise<RawEvent> {
  const output: RawEvent = {
    ...event,
    summary: (await redactor.redact({ text: event.summary })).text
  };

  if (event.payload !== undefined) {
    output.payload = (await redactRecord(event.payload, redactor)) as Record<string, unknown>;
  }

  if (event.source !== undefined) {
    output.source = (await redactRecord(event.source, redactor)) as Record<string, unknown>;
  }

  return output;
}

async function redactRecord(value: Record<string, unknown>, redactor: Redactor): Promise<Record<string, unknown>> {
  const entries = await Promise.all(
    Object.entries(value).map(async ([key, entryValue]) => [key, await redactUnknown(entryValue, redactor)] as const)
  );

  return Object.fromEntries(entries);
}

async function redactUnknown(value: unknown, redactor: Redactor): Promise<unknown> {
  if (typeof value === 'string') {
    return (await redactor.redact({ text: value })).text;
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => redactUnknown(item, redactor)));
  }

  if (value !== null && typeof value === 'object') {
    return redactRecord(value as Record<string, unknown>, redactor);
  }

  return value;
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

export function storeOptions(memberName?: string): { displayName?: string } {
  if (memberName === undefined) {
    return {};
  }

  return {
    displayName: memberName
  };
}

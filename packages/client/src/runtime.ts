import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createAgentContextService,
  type AgentContextService,
  type BuildContextPackInput,
  type ContextPack,
  type ContextPackItem
} from '@devmesh/agent';
import { createDevMeshCore, type CaptureKnowledgeInput, type DevMeshCore, type RateKnowledgeInput } from '@devmesh/core';
import type { Extractor, ExtractProposal, RawEvent, Redactor } from '@devmesh/extension-api';
import { createRuleBasedExtractor, createSecretRedactor } from '@devmesh/extractor';
import { createFileSystemCaptureProvider, createGitCaptureProvider } from '@devmesh/providers';
import {
  appendProjectEvent,
  ensureProjectStore,
  JsonlKnowledgeRepository,
  acceptPendingKnowledge,
  captureProjectKnowledge,
  captureProjectTask,
  enqueuePendingKnowledge,
  readProjectConfig,
  rateProjectKnowledge,
  recordKnowledgeUsage,
  rebuildProjectIndex,
  rejectPendingKnowledge,
  listPendingKnowledge,
  type AcceptPendingKnowledgeResult,
  type CaptureProjectTaskInput,
  type DevMeshEvent,
  type EnqueuePendingKnowledgeOptions,
  type KnowledgeUsageOptions,
  type PendingKnowledgeReviewItem,
  type ProjectStore,
  type RateProjectKnowledgeOptions,
  type RejectPendingKnowledgeResult,
  type RebuildProjectIndexResult
} from '@devmesh/local-store';
import {
  redactCaptureKnowledgeInput,
  redactCaptureProjectTaskInput,
  redactRawEvent,
  redactRateOptions,
  redactReviewOptions,
  storeOptions,
  withDefaultMember,
  withDefaultRatingMember,
  withDefaultTaskMember
} from './runtime-redaction.js';

export interface DevMeshClientOptions {
  projectRoot?: string;
  memberName?: string;
}

export interface PublishExtractProposalResult {
  decision: 'published' | 'queued';
  proposal: ExtractProposal;
  item?: unknown;
  queueItem?: PendingKnowledgeReviewItem;
}

export interface CaptureRawEventResult {
  rawEvent: DevMeshEvent;
  proposals: ExtractProposal[];
  results: PublishExtractProposalResult[];
}

export interface ListDevelopmentSignalsInput {
  limit?: number;
}

export interface ProjectKnowledgeScanInput {
  limit?: number;
}

export interface DevelopmentSignal {
  eventId: string;
  capturedAt: string;
  projectKey: string;
  rawEvent: RawEvent;
  instruction?: string;
}

export interface ProjectKnowledgeSignal {
  kind: string;
  summary: string;
  payload?: Record<string, unknown>;
  source?: Record<string, unknown>;
}

export interface ProjectKnowledgeScanResult {
  projectRoot: string;
  instruction: string;
  limit: number;
  signals: ProjectKnowledgeSignal[];
  highlights: {
    changedFiles: string[];
    fileCount: number;
    todoFiles: string[];
  };
}

export interface DevMeshClientRuntime {
  projectRoot: string;
  core: DevMeshCore;
  agent: AgentContextService;
  ensureProjectStore(): Promise<ProjectStore>;
  captureRawEvent(event: RawEvent, extractor?: Extractor): Promise<CaptureRawEventResult>;
  publishExtractProposal(proposal: ExtractProposal): Promise<PublishExtractProposalResult>;
  captureKnowledge(input: CaptureKnowledgeInput): Promise<unknown>;
  captureTask(input: CaptureProjectTaskInput): Promise<unknown>;
  rateKnowledge(input: RateKnowledgeInput, options?: RateProjectKnowledgeOptions): Promise<unknown>;
  enqueueKnowledgeForReview(
    input: CaptureKnowledgeInput,
    options?: EnqueuePendingKnowledgeOptions
  ): Promise<PendingKnowledgeReviewItem>;
  listInbox(): Promise<PendingKnowledgeReviewItem[]>;
  acceptInboxItem(id: string): Promise<AcceptPendingKnowledgeResult>;
  rejectInboxItem(id: string, reason?: string): Promise<RejectPendingKnowledgeResult>;
  searchContext(input: BuildContextPackInput): Promise<unknown>;
  listDevelopmentSignals(input?: ListDevelopmentSignalsInput): Promise<unknown>;
  scanProjectKnowledge(input?: ProjectKnowledgeScanInput): Promise<unknown>;
  rebuildIndex(): Promise<RebuildProjectIndexResult>;
  status(): Promise<Record<string, unknown>>;
}

export function createDevMeshClientRuntime(options: DevMeshClientOptions = {}): DevMeshClientRuntime {
  const projectRoot = options.projectRoot ?? process.cwd();
  const repository = new JsonlKnowledgeRepository(projectRoot);
  const core = createDevMeshCore({
    projectRoot,
    repository
  });
  const agent = createAgentContextService({ core });
  const redactor = createSecretRedactor();
  const defaultExtractor = createRuleBasedExtractor();

  async function publishExtractProposal(proposal: ExtractProposal): Promise<PublishExtractProposalResult> {
    const risk = readProposalRisk(proposal);
    const captureInput = extractProposalToCaptureInput(proposal);

    if (risk === 'low') {
      const redacted = await redactCaptureKnowledgeInput(withDefaultMember(captureInput, options.memberName), redactor);
      const result = await captureProjectKnowledge(projectRoot, redacted);

      return {
        decision: 'published',
        proposal,
        item: {
          ...result.item,
          event: result.event
        }
      };
    }

    const redacted = await redactCaptureKnowledgeInput(withDefaultMember(captureInput, options.memberName), redactor);
    const reviewOptions = await redactReviewOptions(
      {
        risk: risk === 'high' ? 'high' : 'medium',
        reason: `${risk}-risk automatic extraction from ${readString(proposal.metadata?.sourceEventKind) ?? 'raw event'}.`
      },
      redactor
    );
    const queueItem = await enqueuePendingKnowledge(projectRoot, redacted, reviewOptions);

    return {
      decision: 'queued',
      proposal,
      queueItem
    };
  }

  return {
    projectRoot,
    core,
    agent,
    ensureProjectStore: () => ensureProjectStore(projectRoot, storeOptions(options.memberName)),
    async captureRawEvent(event, extractor = defaultExtractor) {
      const safeEvent = await redactRawEvent(event, redactor);
      const rawEvent = await appendProjectEvent(projectRoot, 'raw.captured', {
        rawEvent: safeEvent
      });
      const proposals = extractor.supports(safeEvent) ? await extractor.extract({ event: safeEvent, projectRoot }) : [];
      const results = await Promise.all(proposals.map((proposal) => publishExtractProposal(proposal)));

      return {
        rawEvent,
        proposals,
        results
      };
    },
    publishExtractProposal,
    async captureKnowledge(input) {
      const redacted = await redactCaptureKnowledgeInput(withDefaultMember(input, options.memberName), redactor);
      const result = await captureProjectKnowledge(projectRoot, redacted);

      return {
        ...result.item,
        event: result.event
      };
    },
    async captureTask(input) {
      const redacted = await redactCaptureProjectTaskInput(withDefaultTaskMember(input, options.memberName), redactor);
      const result = await captureProjectTask(projectRoot, redacted);

      return {
        ...result.item,
        taskStatus: result.status,
        event: result.event
      };
    },
    async rateKnowledge(input, rateOptions = {}) {
      const safeOptions = await redactRateOptions(withDefaultRatingMember(rateOptions, options.memberName), redactor);
      const result = await rateProjectKnowledge(projectRoot, core, input, safeOptions);

      return {
        ...result.item,
        ratingEvent: result.rating,
        event: result.event
      };
    },
    async enqueueKnowledgeForReview(input, reviewOptions = {}) {
      const redacted = await redactCaptureKnowledgeInput(withDefaultMember(input, options.memberName), redactor);
      const safeOptions = await redactReviewOptions(reviewOptions, redactor);

      return enqueuePendingKnowledge(projectRoot, redacted, safeOptions);
    },
    listInbox: () => listPendingKnowledge(projectRoot),
    async acceptInboxItem(id) {
      const accepted = await acceptPendingKnowledge(projectRoot, id);

      try {
        const usage = await recordKnowledgeUsage(
          projectRoot,
          core,
          {
            knowledgeId: accepted.item.id,
            kind: 'review.accepted',
            adoptionDelta: 0.08,
            confidenceDelta: 0.04,
            context: {
              queueId: accepted.queueItem.id,
              risk: accepted.queueItem.risk,
              reason: accepted.queueItem.reason
            }
          },
          usageOptionsForMember(options.memberName)
        );

        return {
          ...accepted,
          item: usage.item
        };
      } catch {
        return accepted;
      }
    },
    async rejectInboxItem(id, reason) {
      if (reason === undefined) {
        return rejectPendingKnowledge(projectRoot, id);
      }

      const safeReason = (await redactor.redact({ text: reason })).text;

      return rejectPendingKnowledge(projectRoot, id, safeReason);
    },
    async searchContext(input) {
      const contextPack = await agent.buildContextPack(input);

      await recordContextPackUsage(projectRoot, core, redactor, contextPack, input, options.memberName).catch(
        () => undefined
      );

      return contextPack;
    },
    async listDevelopmentSignals(input = {}) {
      return {
        projectRoot,
        instruction:
          'Review these development signals with your current coding context. Capture only durable decisions, conventions, pitfalls, commands, or task handoffs with mesh_capture_knowledge or mesh_capture_task.',
        signals: await readDevelopmentSignals(projectRoot, input)
      };
    },
    async scanProjectKnowledge(input = {}) {
      return readProjectKnowledgeScan(projectRoot, input);
    },
    rebuildIndex: () => rebuildProjectIndex(projectRoot),
    async status() {
      const store = await ensureProjectStore(projectRoot, storeOptions(options.memberName));
      const config = await readProjectConfig(projectRoot);
      const items = await core.listKnowledge({ includeSuperseded: true });

      return {
        mode: 'local-only',
        schemaVersion: config.schemaVersion,
        projectRoot,
        storeRoot: store.storeRoot,
        knowledgeItems: items.length,
        autoInit: true,
        autoReference: true,
        autoCapture: true,
        autoSync: true
      };
    }
  };
}

async function recordContextPackUsage(
  projectRoot: string,
  core: DevMeshCore,
  redactor: Redactor,
  contextPack: ContextPack,
  input: BuildContextPackInput,
  memberName?: string
): Promise<void> {
  if (contextPack.items.length === 0) {
    return;
  }

  const redactedQuery = (await redactor.redact({ text: input.query })).text;
  const options = usageOptionsForMember(memberName);

  await Promise.all(
    contextPack.items.map(async (item, index) => {
      await recordKnowledgeUsage(
        projectRoot,
        core,
        {
          knowledgeId: item.id,
          kind: 'context_pack.hit',
          adoptionDelta: 0.01,
          context: createContextPackUsageContext(input, item, index, contextPack.items.length, redactedQuery)
        },
        options
      );
    })
  );
}

function createContextPackUsageContext(
  input: BuildContextPackInput,
  item: ContextPackItem,
  index: number,
  resultCount: number,
  query: string
): Record<string, unknown> {
  const context: Record<string, unknown> = {
    tool: 'mesh_search_context',
    query,
    rank: index + 1,
    resultCount,
    layer: item.layer,
    type: item.type,
    entryKey: item.entryKey
  };

  if (input.authorName !== undefined) {
    context.authorName = input.authorName;
  }

  if (input.para !== undefined) {
    context.para = input.para;
  }

  if (input.recencyDays !== undefined) {
    context.recencyDays = input.recencyDays;
  }

  return context;
}

function usageOptionsForMember(memberName: string | undefined): KnowledgeUsageOptions {
  if (memberName === undefined) {
    return {};
  }

  return {
    createdBy: {
      displayName: memberName
    }
  };
}

async function readDevelopmentSignals(
  projectRoot: string,
  input: ListDevelopmentSignalsInput
): Promise<DevelopmentSignal[]> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 10), 1), 50);
  const store = await ensureProjectStore(projectRoot);
  const events = await readProjectEvents(store.paths.eventsDir);

  return events
    .filter((event) => event.kind === 'raw.captured')
    .map(toDevelopmentSignal)
    .filter((signal): signal is DevelopmentSignal => signal !== undefined)
    .sort((left, right) => `${right.capturedAt}:${right.eventId}`.localeCompare(`${left.capturedAt}:${left.eventId}`))
    .slice(0, limit);
}

async function readProjectKnowledgeScan(
  projectRoot: string,
  input: ProjectKnowledgeScanInput
): Promise<ProjectKnowledgeScanResult> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200);
  const signals: ProjectKnowledgeSignal[] = [];
  const changedFiles: string[] = [];
  const todoFiles: string[] = [];
  const providers = [
    createGitCaptureProvider(),
    createFileSystemCaptureProvider({
      maxFiles: limit
    })
  ];

  for (const provider of providers) {
    if (!(await provider.detect(projectRoot))) {
      continue;
    }

    for await (const event of provider.collect({ projectRoot })) {
      signals.push(summarizeProjectKnowledgeSignal(event));

      if (event.kind === 'git.snapshot') {
        changedFiles.push(...readChangedFilePaths(event.payload));
      }

      if (event.kind === 'filesystem.snapshot') {
        const fileSummaries = readFileSummaries(event.payload);

        changedFiles.push(...fileSummaries.map((file) => file.path));
        todoFiles.push(...fileSummaries.filter((file) => (file.markers?.todo ?? 0) + (file.markers?.fixme ?? 0) > 0).map((file) => file.path));
      }
    }
  }

  return {
    projectRoot,
    instruction:
      'Use your own coding context to inspect the listed signals and the most relevant source files, then summarize only durable decisions, conventions, pitfalls, commands, or task handoffs with mesh_capture_knowledge or mesh_capture_task.',
    limit,
    signals,
    highlights: {
      changedFiles: uniqueStrings(changedFiles).slice(0, limit),
      fileCount: changedFiles.length,
      todoFiles: uniqueStrings(todoFiles).slice(0, limit)
    }
  };
}

async function readProjectEvents(eventsDir: string): Promise<DevMeshEvent[]> {
  let files: string[];

  try {
    files = await readdir(eventsDir);
  } catch {
    return [];
  }

  const events: DevMeshEvent[] = [];

  for (const file of files.filter((entry) => entry.endsWith('.jsonl')).sort()) {
    const content = await readFile(join(eventsDir, file), 'utf8');

    for (const line of content.split(/\r?\n/)) {
      const event = parseProjectEventLine(line);

      if (event !== undefined) {
        events.push(event);
      }
    }
  }

  return events;
}

function parseProjectEventLine(line: string): DevMeshEvent | undefined {
  const trimmed = line.trim();

  if (!trimmed) {
    return undefined;
  }

  try {
    const value = JSON.parse(trimmed) as Partial<DevMeshEvent>;

    if (
      typeof value.id === 'string' &&
      typeof value.kind === 'string' &&
      typeof value.projectKey === 'string' &&
      typeof value.createdAt === 'string' &&
      isRecord(value.payload)
    ) {
      return {
        id: value.id,
        kind: value.kind,
        projectKey: value.projectKey,
        createdAt: value.createdAt,
        payload: value.payload
      };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function toDevelopmentSignal(event: DevMeshEvent): DevelopmentSignal | undefined {
  const rawEvent = event.payload.rawEvent;

  if (!isRawEvent(rawEvent)) {
    return undefined;
  }

  const signal: DevelopmentSignal = {
    eventId: event.id,
    capturedAt: event.createdAt,
    projectKey: event.projectKey,
    rawEvent
  };
  const processing = isRecord(event.payload.processing) ? event.payload.processing : {};
  const instruction = readString(processing.instruction);

  if (instruction !== undefined) {
    signal.instruction = instruction;
  }

  return signal;
}

function isRawEvent(value: unknown): value is RawEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.createdAt === 'string' &&
    (value.payload === undefined || isRecord(value.payload)) &&
    (value.source === undefined || isRecord(value.source))
  );
}

function summarizeProjectKnowledgeSignal(event: RawEvent): ProjectKnowledgeSignal {
  const signal: ProjectKnowledgeSignal = {
    kind: event.kind,
    summary: event.summary
  };

  if (isRecord(event.payload)) {
    signal.payload = event.payload;
  }

  if (isRecord(event.source)) {
    signal.source = event.source;
  }

  return signal;
}

function readChangedFilePaths(payload: Record<string, unknown> | undefined): string[] {
  if (payload === undefined) {
    return [];
  }

  return readRecordList(payload.changedFiles)
    .map((record) => readString(record.path))
    .filter((path): path is string => path !== undefined);
}

function readFileSummaries(
  payload: Record<string, unknown> | undefined
): Array<{ markers?: { fixme?: number; todo?: number }; path: string }> {
  if (payload === undefined) {
    return [];
  }

  return readRecordList(payload.files)
    .map((record) => {
      const path = readString(record.path);

      if (path === undefined) {
        return undefined;
      }

      const summary: { markers?: { fixme?: number; todo?: number }; path: string } = {
        path
      };

      if (isRecord(record.markers)) {
        const markers: { fixme?: number; todo?: number } = {};
        const todo = readNumber(record.markers.todo);
        const fixme = readNumber(record.markers.fixme);

        if (todo !== undefined) {
          markers.todo = todo;
        }

        if (fixme !== undefined) {
          markers.fixme = fixme;
        }

        if (Object.keys(markers).length > 0) {
          summary.markers = markers;
        }
      }

      return summary;
    })
    .filter((file): file is { markers?: { fixme?: number; todo?: number }; path: string } => file !== undefined);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function extractProposalToCaptureInput(proposal: ExtractProposal): CaptureKnowledgeInput {
  const source: NonNullable<CaptureKnowledgeInput['source']> = {
    kind: 'extractor'
  };
  const input: CaptureKnowledgeInput = {
    type: proposal.type,
    title: proposal.title,
    summary: proposal.summary,
    layer: 'extract',
    source,
    tags: proposal.tags ?? []
  };

  if (proposal.confidence !== undefined) {
    input.confidence = proposal.confidence;
  }

  if (proposal.para !== undefined) {
    input.para = proposal.para;
  }

  if (proposal.metadata !== undefined) {
    source.metadata = proposal.metadata;

    const sourceEventId = readString(proposal.metadata.sourceEventId);

    if (sourceEventId !== undefined) {
      source.ref = sourceEventId;
    }
  }

  return input;
}

function readProposalRisk(proposal: ExtractProposal): 'low' | 'medium' | 'high' {
  const risk = readString(proposal.metadata?.risk);

  if (risk === 'high' || risk === 'medium') {
    return risk;
  }

  return 'low';
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readRecordList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => (isRecord(item) ? item : {})).filter((item) => Object.keys(item).length > 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

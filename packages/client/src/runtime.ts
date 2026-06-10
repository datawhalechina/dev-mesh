import {
  createAgentContextService,
  type AgentContextService,
  type BuildContextPackInput,
  type ContextPack,
  type ContextPackItem
} from '@devmesh/agent';
import {
  createDevMeshCore,
  type CaptureKnowledgeInput,
  type DeleteKnowledgeInput,
  type DevMeshCore,
  type KnowledgeFilter,
  type RateKnowledgeInput,
  type UpdateKnowledgeInput
} from '@devmesh/core';
import type { ProjectScanRecord, Redactor } from '@devmesh/extension-api';
import { createSecretRedactor } from '@devmesh/redaction';
import { createFileSystemProjectScanProvider, createGitProjectScanProvider } from '@devmesh/providers';
import { DEV_MESH_VERSION } from '@devmesh/shared';
import {
  ensureProjectStore,
  JsonlKnowledgeRepository,
  acceptPendingKnowledge,
  captureProjectKnowledge,
  captureProjectTask,
  createProjectKnowledgeEdge,
  deleteProjectKnowledge,
  enqueuePendingKnowledge,
  readProjectConfig,
  listProjectKnowledgeEdges,
  rateProjectKnowledge,
  recordKnowledgeUsage,
  exploreProjectGraph,
  rebuildProjectIndex,
  rejectPendingKnowledge,
  listPendingKnowledge,
  type AcceptPendingKnowledgeResult,
  type CreateProjectKnowledgeEdgeInput,
  type CreateProjectKnowledgeEdgeResult,
  type CaptureProjectTaskInput,
  type DeleteProjectKnowledgeOptions,
  type EnqueuePendingKnowledgeOptions,
  type KnowledgeUsageOptions,
  type PendingKnowledgeReviewItem,
  type ProjectKnowledgeEdge,
  type ProjectKnowledgeEdgeQuery,
  type ProjectStore,
  type ProjectKnowledgeGraphExploreInput,
  type ProjectKnowledgeGraphExploreResult,
  type RateProjectKnowledgeOptions,
  type RejectPendingKnowledgeResult,
  type RebuildProjectIndexResult,
  type UpdateProjectKnowledgeOptions,
  updateProjectKnowledge
} from '@devmesh/local-store';
import {
  redactCaptureKnowledgeInput,
  redactCaptureProjectTaskInput,
  redactDeleteOptions,
  redactKnowledgeEdgeInput,
  redactRateOptions,
  redactReviewOptions,
  redactUpdateKnowledgeInput,
  redactUpdateOptions,
  storeOptions,
  withDefaultDeleteMember,
  withDefaultEdgeMember,
  withDefaultMember,
  withDefaultRatingMember,
  withDefaultTaskMember,
  withDefaultUpdateMember
} from './runtime-redaction.js';

export interface DevMeshClientOptions {
  projectRoot?: string;
  memberName?: string;
}

export interface ProjectKnowledgeScanInput {
  limit?: number;
}

export interface ProjectKnowledgeFinding {
  kind: string;
  summary: string;
  payload?: Record<string, unknown>;
  source?: Record<string, unknown>;
}

export interface ProjectKnowledgeScanResult {
  projectRoot: string;
  instruction: string;
  limit: number;
  findings: ProjectKnowledgeFinding[];
  highlights: {
    changedFiles: string[];
    fileCount: number;
    todoFiles: string[];
  };
}

export interface ListProjectKnowledgeInput extends KnowledgeFilter {
  limit?: number;
}

export interface DevMeshClientRuntime {
  projectRoot: string;
  core: DevMeshCore;
  agent: AgentContextService;
  ensureProjectStore(): Promise<ProjectStore>;
  captureKnowledge(input: CaptureKnowledgeInput): Promise<unknown>;
  captureTask(input: CaptureProjectTaskInput): Promise<unknown>;
  getKnowledge(id: string): Promise<unknown>;
  listKnowledge(input?: ListProjectKnowledgeInput): Promise<unknown>;
  updateKnowledge(input: UpdateKnowledgeInput, options?: UpdateProjectKnowledgeOptions): Promise<unknown>;
  deleteKnowledge(input: DeleteKnowledgeInput, options?: DeleteProjectKnowledgeOptions): Promise<unknown>;
  rateKnowledge(input: RateKnowledgeInput, options?: RateProjectKnowledgeOptions): Promise<unknown>;
  linkKnowledge(input: CreateProjectKnowledgeEdgeInput): Promise<CreateProjectKnowledgeEdgeResult>;
  listKnowledgeEdges(input?: ProjectKnowledgeEdgeQuery): Promise<ProjectKnowledgeEdge[]>;
  enqueueKnowledgeForReview(
    input: CaptureKnowledgeInput,
    options?: EnqueuePendingKnowledgeOptions
  ): Promise<PendingKnowledgeReviewItem>;
  listInbox(): Promise<PendingKnowledgeReviewItem[]>;
  acceptInboxItem(id: string): Promise<AcceptPendingKnowledgeResult>;
  rejectInboxItem(id: string, reason?: string): Promise<RejectPendingKnowledgeResult>;
  searchContext(input: BuildContextPackInput): Promise<unknown>;
  scanProjectKnowledge(input?: ProjectKnowledgeScanInput): Promise<unknown>;
  exploreKnowledgeGraph(input?: ProjectKnowledgeGraphExploreInput): Promise<ProjectKnowledgeGraphExploreResult>;
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

  return {
    projectRoot,
    core,
    agent,
    ensureProjectStore: () => ensureProjectStore(projectRoot, storeOptions(options.memberName)),
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
    async getKnowledge(id) {
      const item = await core.getKnowledge(id);

      if (item === undefined) {
        return {
          found: false,
          id,
          message: `Knowledge item ${id} was not found.`
        };
      }

      return item;
    },
    async listKnowledge(input = {}) {
      const { limit = 20, ...filter } = input;
      const items = await core.listKnowledge(filter);

      return {
        total: items.length,
        limit,
        items: items.slice(0, limit)
      };
    },
    async updateKnowledge(input, updateOptions = {}) {
      const redacted = await redactUpdateKnowledgeInput(input, redactor);
      const safeOptions = await redactUpdateOptions(
        withDefaultUpdateMember(updateOptions, options.memberName),
        redactor
      );
      const result = await updateProjectKnowledge(projectRoot, core, redacted, safeOptions);

      return {
        ...result.item,
        event: result.event
      };
    },
    async deleteKnowledge(input, deleteOptions = {}) {
      const safeOptions = await redactDeleteOptions(
        withDefaultDeleteMember(deleteOptions, options.memberName),
        redactor
      );
      const result = await deleteProjectKnowledge(projectRoot, core, input, safeOptions);

      return {
        ...result.item,
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
    async linkKnowledge(input) {
      const safeInput = await redactKnowledgeEdgeInput(withDefaultEdgeMember(input, options.memberName), redactor);

      return createProjectKnowledgeEdge(projectRoot, safeInput);
    },
    listKnowledgeEdges: (input = {}) => listProjectKnowledgeEdges(projectRoot, input),
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
    async scanProjectKnowledge(input = {}) {
      return readProjectKnowledgeScan(projectRoot, input);
    },
    exploreKnowledgeGraph: (input = {}) => exploreProjectGraph(projectRoot, input),
    rebuildIndex: () => rebuildProjectIndex(projectRoot),
    async status() {
      const store = await ensureProjectStore(projectRoot, storeOptions(options.memberName));
      const config = await readProjectConfig(projectRoot);
      const items = await core.listKnowledge({ includeSuperseded: true });

      return {
        service: 'devmesh',
        version: DEV_MESH_VERSION,
        mode: 'local-only',
        schemaVersion: config.schemaVersion,
        projectRoot,
        storeRoot: store.storeRoot,
        knowledgeItems: items.length,
        autoInit: config.automation.autoInit,
        autoReference: config.automation.autoReference,
        autoSync: config.automation.autoSync
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

async function readProjectKnowledgeScan(
  projectRoot: string,
  input: ProjectKnowledgeScanInput
): Promise<ProjectKnowledgeScanResult> {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200);
  const findings: ProjectKnowledgeFinding[] = [];
  const changedFiles: string[] = [];
  const todoFiles: string[] = [];
  const providers = [
    createGitProjectScanProvider(),
    createFileSystemProjectScanProvider({
      maxFiles: limit
    })
  ];

  for (const provider of providers) {
    if (!(await provider.detect(projectRoot))) {
      continue;
    }

    for await (const event of provider.collect({ projectRoot })) {
      findings.push(summarizeProjectKnowledgeFinding(event));

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
      'Use this on-demand scan only when you decide a project-wide sweep would help. Inspect the listed highlights and relevant source files yourself, then summarize only durable decisions, conventions, pitfalls, commands, or task handoffs with mesh_capture_knowledge or mesh_capture_task.',
    limit,
    findings,
    highlights: {
      changedFiles: uniqueStrings(changedFiles).slice(0, limit),
      fileCount: changedFiles.length,
      todoFiles: uniqueStrings(todoFiles).slice(0, limit)
    }
  };
}

function summarizeProjectKnowledgeFinding(event: ProjectScanRecord): ProjectKnowledgeFinding {
  const finding: ProjectKnowledgeFinding = {
    kind: event.kind,
    summary: event.summary
  };

  if (isRecord(event.payload)) {
    finding.payload = event.payload;
  }

  if (isRecord(event.source)) {
    finding.source = event.source;
  }

  return finding;
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

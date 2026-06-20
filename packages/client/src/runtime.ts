import {
  createAgentContextService,
  type AgentContextService,
  type BuildContextPackInput,
  type ContextPack,
  type ContextPackItem
} from '@devmesh/agent';
import {
  createDevMeshCore,
  isKnowledgeTypeAllowedForAutoCapture,
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
  exportProjectCrdtKnowledgeJsonl,
  readProjectConfig,
  readProjectBranchScope,
  writeProjectConfig,
  listProjectKnowledgeEdges,
  rateProjectKnowledge,
  readProjectProjectionStatus,
  recordKnowledgeUsage,
  exploreProjectGraph,
  rebuildProjectIndex,
  rebuildProjectProjectionsFromCrdt,
  rejectPendingKnowledge,
  listPendingKnowledge,
  type AcceptPendingKnowledgeResult,
  type CreateProjectKnowledgeEdgeInput,
  type CreateProjectKnowledgeEdgeResult,
  type CaptureProjectTaskInput,
  type DeleteProjectKnowledgeOptions,
  type EnqueuePendingKnowledgeOptions,
  type ExportProjectCrdtKnowledgeJsonlResult,
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
  type RebuildProjectProjectionsFromCrdtResult,
  type UpdateProjectKnowledgeOptions,
  updateProjectKnowledge
} from '@devmesh/local-store';
import type { KnowledgeBranchPolicyPreset, ProjectBranchScope, ProjectConfig } from '@devmesh/local-store';
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
import { readDaemonSyncHeads, readDaemonSyncStatus } from './daemon-sync.js';

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

export interface ExportProjectKnowledgeInput {
  path?: string;
  includeTombstones?: boolean;
}

export type ExportProjectKnowledgeResult = ExportProjectCrdtKnowledgeJsonlResult;

export interface ListProjectKnowledgeInput extends KnowledgeFilter {
  limit?: number;
  branch?: string;
}

export interface KnowledgeBranchListResult {
  active: string;
  base?: string;
  branches: Array<{
    name: string;
    active: boolean;
    base: boolean;
    policy: KnowledgeBranchPolicyPreset;
  }>;
}

export interface KnowledgeBranchMutationInput {
  name: string;
  policy?: KnowledgeBranchPolicyPreset;
  base?: string;
}

export interface KnowledgeBranchPolicyInput {
  name?: string;
  policy: KnowledgeBranchPolicyPreset;
}

type BranchScopedGraphExploreInput = ProjectKnowledgeGraphExploreInput & {
  branch?: string;
};

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
  listBranches(): Promise<KnowledgeBranchListResult>;
  createBranch(input: KnowledgeBranchMutationInput): Promise<KnowledgeBranchListResult>;
  switchBranch(input: KnowledgeBranchMutationInput): Promise<KnowledgeBranchListResult>;
  setBranchPolicy(input: KnowledgeBranchPolicyInput): Promise<KnowledgeBranchListResult>;
  searchContext(input: BuildContextPackInput): Promise<unknown>;
  scanProjectKnowledge(input?: ProjectKnowledgeScanInput): Promise<unknown>;
  exportKnowledge(input?: ExportProjectKnowledgeInput): Promise<ExportProjectKnowledgeResult>;
  exploreKnowledgeGraph(input?: BranchScopedGraphExploreInput): Promise<ProjectKnowledgeGraphExploreResult>;
  rebuildIndex(): Promise<RebuildProjectIndexResult>;
  projectionStatus(): Promise<unknown>;
  rebuildProjectionsFromCrdt(): Promise<RebuildProjectProjectionsFromCrdtResult>;
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
      const config = await readProjectConfig(projectRoot);

      if (!isKnowledgeTypeAllowedForAutoCapture(redacted.type, config.knowledge.autoCaptureTypes)) {
        const queued = await enqueuePendingKnowledge(projectRoot, redacted, {
          risk: 'medium',
          reason: `Knowledge type "${redacted.type}" is not enabled for automatic capture. Review it before publishing.`,
          branch: config.knowledgeBranch.active
        });

        return {
          status: 'pending_review',
          queueId: queued.id,
          risk: queued.risk,
          reason: queued.reason,
          type: queued.input.type,
          title: queued.input.title,
          summary: queued.input.summary
        };
      }

      const result = await captureProjectKnowledge(projectRoot, redacted, {
        branch: config.knowledgeBranch.active
      });

      return {
        ...result.item,
        event: result.event
      };
    },
    async captureTask(input) {
      const redacted = await redactCaptureProjectTaskInput(withDefaultTaskMember(input, options.memberName), redactor);
      const config = await readProjectConfig(projectRoot);
      const result = await captureProjectTask(projectRoot, redacted, {
        branch: config.knowledgeBranch.active
      });

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
      const { limit = 20, branch, ...filter } = input;
      const repository = branch === undefined ? repositoryForActiveScope(projectRoot) : repositoryForBranch(projectRoot, branch);
      const items = await repository.list(filter);

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
    async listBranches() {
      return toBranchListResult(await readProjectConfig(projectRoot));
    },
    async createBranch(input) {
      const config = await readProjectConfig(projectRoot);
      const name = normalizeBranchName(input.name);
      const policy = input.policy ?? 'balanced';
      const next = ensureBranch(config, name, policy);

      if (input.base !== undefined) {
        next.knowledgeBranch.base = normalizeBranchName(input.base);
        ensureBranch(next, next.knowledgeBranch.base, 'durable_only');
      }

      const saved = await writeProjectConfig(projectRoot, next);
      return toBranchListResult(saved);
    },
    async switchBranch(input) {
      const config = await readProjectConfig(projectRoot);
      const name = normalizeBranchName(input.name);
      const next = ensureBranch(config, name, input.policy ?? 'balanced');

      next.knowledgeBranch.active = name;

      if (input.policy !== undefined) {
        const branch = next.knowledgeBranch.branches.find((branch) => branch.name === name);

        if (branch !== undefined) {
          branch.policy = input.policy;
        }
      }

      if (input.base !== undefined) {
        next.knowledgeBranch.base = normalizeBranchName(input.base);
        ensureBranch(next, next.knowledgeBranch.base, 'durable_only');
      }

      const activeBranch = next.knowledgeBranch.branches.find((branch) => branch.name === name);

      if (activeBranch !== undefined) {
        next.knowledge.autoCaptureTypes = autoCaptureTypesForBranchPolicy(activeBranch.policy);
        next.knowledge.includeVolatileInContext = includeVolatileForBranchPolicy(activeBranch.policy);
      }

      const saved = await writeProjectConfig(projectRoot, next);
      return toBranchListResult(saved);
    },
    async setBranchPolicy(input) {
      const config = await readProjectConfig(projectRoot);
      const name = normalizeBranchName(input.name ?? config.knowledgeBranch.active);
      const next = ensureBranch(config, name, input.policy);
      const branch = next.knowledgeBranch.branches.find((branch) => branch.name === name);

      if (branch !== undefined) {
        branch.policy = input.policy;
      }

      if (name === next.knowledgeBranch.active) {
        next.knowledge.autoCaptureTypes = autoCaptureTypesForBranchPolicy(input.policy);
        next.knowledge.includeVolatileInContext = includeVolatileForBranchPolicy(input.policy);
      }

      const saved = await writeProjectConfig(projectRoot, next);
      return toBranchListResult(saved);
    },
    async searchContext(input) {
      const config = await readProjectConfig(projectRoot);
      const contextInput: BuildContextPackInput = {
        ...input,
        includeVolatile: input.includeVolatile ?? config.knowledge.includeVolatileInContext
      };
      const scopedAgent = input.branch === undefined ? agent : createAgentContextService({
        core: createDevMeshCore({
          projectRoot,
          repository: repositoryForBranch(projectRoot, input.branch)
        })
      });
      const usageCore = input.branch === undefined
        ? core
        : createDevMeshCore({
            projectRoot,
            repository: repositoryForBranch(projectRoot, input.branch)
          });
      const contextPack = await scopedAgent.buildContextPack(contextInput);

      await recordContextPackUsage(projectRoot, usageCore, redactor, contextPack, contextInput, options.memberName).catch(
        () => undefined
      );

      return contextPack;
    },
    async scanProjectKnowledge(input = {}) {
      return readProjectKnowledgeScan(projectRoot, input);
    },
    exportKnowledge: (input = {}) => exportProjectCrdtKnowledgeJsonl(projectRoot, input),
    async exploreKnowledgeGraph(input = {}) {
      return exploreProjectGraph(
        projectRoot,
        input,
        input.branch === undefined ? await readProjectBranchScope(projectRoot) : createSingleBranchScope(input.branch)
      );
    },
    rebuildIndex: () => rebuildProjectIndex(projectRoot),
    projectionStatus: () => readProjectProjectionStatus(projectRoot),
    rebuildProjectionsFromCrdt: () => rebuildProjectProjectionsFromCrdt(projectRoot),
    async status() {
      const store = await ensureProjectStore(projectRoot, storeOptions(options.memberName));
      const config = await readProjectConfig(projectRoot);
      const unscopedRepository = new JsonlKnowledgeRepository(projectRoot, { branchScope: false });
      const items = await unscopedRepository.list({ includeSuperseded: true });
      const projection = await readProjectProjectionStatus(projectRoot);
      const [daemonSync, daemonHeads] = await Promise.all([
        readDaemonSyncStatus(projectRoot),
        readDaemonSyncHeads(projectRoot)
      ]);

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
        autoSync: config.automation.autoSync,
        activeBranch: config.knowledgeBranch.active,
        baseBranch: config.knowledgeBranch.base,
        branches: config.knowledgeBranch.branches,
        autoCaptureTypes: config.knowledge.autoCaptureTypes,
        includeVolatileInContext: config.knowledge.includeVolatileInContext,
        projection,
        sync: {
          daemon: daemonSync,
          heads: daemonHeads
        }
      };
    }
  };
}

function toBranchListResult(config: ProjectConfig): KnowledgeBranchListResult {
  const result: KnowledgeBranchListResult = {
    active: config.knowledgeBranch.active,
    branches: config.knowledgeBranch.branches.map((branch) => ({
      name: branch.name,
      active: branch.name === config.knowledgeBranch.active,
      base: branch.name === config.knowledgeBranch.base,
      policy: branch.policy
    }))
  };

  if (config.knowledgeBranch.base !== undefined) {
    result.base = config.knowledgeBranch.base;
  }

  return result;
}

function ensureBranch(
  config: ProjectConfig,
  name: string,
  policy: KnowledgeBranchPolicyPreset
): ProjectConfig {
  const next = cloneProjectConfig(config);
  const existing = next.knowledgeBranch.branches.find((branch) => branch.name === name);

  if (existing === undefined) {
    next.knowledgeBranch.branches.push({
      name,
      policy
    });
  }

  return next;
}

function cloneProjectConfig(config: ProjectConfig): ProjectConfig {
  return JSON.parse(JSON.stringify(config)) as ProjectConfig;
}

function normalizeBranchName(value: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error('Knowledge branch name cannot be empty.');
  }

  return normalized;
}

function repositoryForActiveScope(projectRoot: string): JsonlKnowledgeRepository {
  return new JsonlKnowledgeRepository(projectRoot);
}

function repositoryForBranch(projectRoot: string, branch: string): JsonlKnowledgeRepository {
  return new JsonlKnowledgeRepository(projectRoot, {
    branchScope: createSingleBranchScope(branch)
  });
}

function createSingleBranchScope(branch: string): ProjectBranchScope {
  const active = normalizeBranchName(branch);

  return {
    active,
    readable: [active]
  };
}

function autoCaptureTypesForBranchPolicy(policy: KnowledgeBranchPolicyPreset): string[] {
  switch (policy) {
    case 'durable_only':
      return ['decision', 'adr', 'macro_experience', 'design_principle', 'pitfall_record'];
    case 'frontend_design':
      return ['decision', 'convention', 'pitfall_record', 'macro_experience', 'design_principle', 'adr', 'note'];
    case 'backend_design':
      return ['decision', 'convention', 'pitfall_record', 'macro_experience', 'design_principle', 'adr', 'runbook', 'note'];
    case 'balanced':
      return [
        'decision',
        'convention',
        'task',
        'pitfall',
        'pitfall_record',
        'command',
        'glossary',
        'runbook',
        'adr',
        'note',
        'macro_experience',
        'design_principle'
      ];
  }
}

function includeVolatileForBranchPolicy(_policy: KnowledgeBranchPolicyPreset): boolean {
  return false;
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

  if (input.branch !== undefined) {
    context.branch = input.branch;
  }

  if (input.para !== undefined) {
    context.para = input.para;
  }

  if (input.recencyDays !== undefined) {
    context.recencyDays = input.recencyDays;
  }

  if (input.includeVolatile !== undefined) {
    context.includeVolatile = input.includeVolatile;
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

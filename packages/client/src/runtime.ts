import { createAgentContextService, type AgentContextService, type BuildContextPackInput } from '@mcp-dev-mesh/agent';
import { createDevMeshCore, type CaptureKnowledgeInput, type DevMeshCore, type RateKnowledgeInput } from '@mcp-dev-mesh/core';
import { createSecretRedactor } from '@mcp-dev-mesh/extractor';
import {
  ensureProjectStore,
  JsonlKnowledgeRepository,
  acceptPendingKnowledge,
  captureProjectKnowledge,
  captureProjectTask,
  enqueuePendingKnowledge,
  readProjectConfig,
  rateProjectKnowledge,
  rebuildProjectIndex,
  rejectPendingKnowledge,
  listPendingKnowledge,
  type AcceptPendingKnowledgeResult,
  type CaptureProjectTaskInput,
  type EnqueuePendingKnowledgeOptions,
  type PendingKnowledgeReviewItem,
  type ProjectStore,
  type RateProjectKnowledgeOptions,
  type RejectPendingKnowledgeResult,
  type RebuildProjectIndexResult
} from '@mcp-dev-mesh/local-store';
import {
  redactCaptureKnowledgeInput,
  redactCaptureProjectTaskInput,
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

export interface DevMeshClientRuntime {
  projectRoot: string;
  core: DevMeshCore;
  agent: AgentContextService;
  ensureProjectStore(): Promise<ProjectStore>;
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
    acceptInboxItem: (id) => acceptPendingKnowledge(projectRoot, id),
    async rejectInboxItem(id, reason) {
      if (reason === undefined) {
        return rejectPendingKnowledge(projectRoot, id);
      }

      const safeReason = (await redactor.redact({ text: reason })).text;

      return rejectPendingKnowledge(projectRoot, id, safeReason);
    },
    searchContext: (input) => agent.buildContextPack(input),
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
        autoSync: false
      };
    }
  };
}

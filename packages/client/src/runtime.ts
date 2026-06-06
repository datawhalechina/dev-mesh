import { createAgentContextService, type AgentContextService, type BuildContextPackInput } from '@mcp-dev-mesh/agent';
import { createDevMeshCore, type CaptureKnowledgeInput, type DevMeshCore, type RateKnowledgeInput } from '@mcp-dev-mesh/core';
import type { Extractor, ExtractProposal, RawEvent } from '@mcp-dev-mesh/extension-api';
import { createRuleBasedExtractor, createSecretRedactor } from '@mcp-dev-mesh/extractor';
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
  rebuildProjectIndex,
  rejectPendingKnowledge,
  listPendingKnowledge,
  type AcceptPendingKnowledgeResult,
  type CaptureProjectTaskInput,
  type DevMeshEvent,
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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createAgentContextService, type BuildContextPackInput } from '@mcp-dev-mesh/agent';
import type {
  CaptureKnowledgeInput,
  DevMeshCore,
  KnowledgeLayer,
  KnowledgeType,
  KnowledgeVisibility,
  ParaRef,
  RateKnowledgeInput
} from '@mcp-dev-mesh/core';
import {
  registerMeshTools,
  type MeshCaptureKnowledgeInput,
  type MeshCaptureTaskInput,
  type MeshListDevelopmentSignalsInput,
  type MeshRateKnowledgeInput,
  type MeshScanProjectKnowledgeInput,
  type MeshSearchContextInput
} from '@mcp-dev-mesh/mcp-contracts';
import {
  captureProjectKnowledge,
  captureProjectTask,
  JsonlKnowledgeRepository,
  rateProjectKnowledge,
  type CaptureProjectKnowledgeResult,
  type CaptureProjectTaskInput,
  type CaptureProjectTaskResult,
  type RateProjectKnowledgeResult
} from '@mcp-dev-mesh/local-store';

export function createMeshMcpServer(core: DevMeshCore): McpServer {
  const mcp = new McpServer({
    name: 'mcp-dev-mesh',
    version: '0.1.0'
  });
  const agent = createAgentContextService({ core });

  registerMeshTools(mcp, {
    async searchContext(input) {
      return agent.buildContextPack(toContextPackInput(input));
    },
    async captureKnowledge(input) {
      const capture = toCaptureInput(input);

      if (isLocalStoreBacked(core)) {
        return flattenCaptureResult(await captureProjectKnowledge(core.projectRoot, capture));
      }

      return core.captureKnowledge(capture);
    },
    async captureTask(input) {
      if (isLocalStoreBacked(core)) {
        return flattenTaskCaptureResult(await captureProjectTask(core.projectRoot, toProjectTaskCaptureInput(input)));
      }

      return core.captureKnowledge(toTaskCaptureInput(input));
    },
    async rateKnowledge(input) {
      const rate = toRateInput(input);

      if (isLocalStoreBacked(core)) {
        return flattenRateResult(await rateProjectKnowledge(core.projectRoot, core, rate));
      }

      return core.rateKnowledge(rate);
    },
    async searchMemberExperience(input) {
      return agent.buildContextPack({
        ...toContextPackInput(input),
        authorName: input.memberName
      });
    },
    async resolveTerm(input) {
      return core.searchKnowledge({
        query: input.term,
        types: ['glossary'],
        limit: input.limit
      });
    },
    async listDevelopmentSignals(input: MeshListDevelopmentSignalsInput) {
      return {
        projectRoot: core.projectRoot,
        instruction: 'Development signals are captured by the local daemon, not the remote Hub MCP server.',
        limit: input.limit,
        signals: []
      };
    },
    async scanProjectKnowledge(input: MeshScanProjectKnowledgeInput) {
      return {
        projectRoot: core.projectRoot,
        instruction: 'Project-wide scanning is only meaningful in the local daemon where Git and filesystem access are available.',
        limit: input.limit,
        signals: [],
        highlights: {
          changedFiles: [],
          fileCount: 0,
          todoFiles: []
        }
      };
    }
  });

  return mcp;
}

function toContextPackInput(input: MeshSearchContextInput): BuildContextPackInput {
  const search: BuildContextPackInput = {
    query: input.query,
    layers: input.layers as KnowledgeLayer[],
    limit: input.limit,
    includeSuperseded: input.includeSuperseded
  };

  if (input.authorName !== undefined) {
    search.authorName = input.authorName;
  }

  if (input.para) {
    search.para = input.para as Partial<ParaRef>;
  }

  if (input.types !== undefined) {
    search.types = input.types as KnowledgeType[];
  }

  if (input.recencyDays !== undefined) {
    search.recencyDays = input.recencyDays;
  }

  return search;
}

function toRateInput(input: MeshRateKnowledgeInput): RateKnowledgeInput {
  const rate: RateKnowledgeInput = {
    id: input.id
  };

  if (input.rating !== undefined) {
    rate.rating = input.rating;
  }

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

function isLocalStoreBacked(core: DevMeshCore): boolean {
  return core.repository instanceof JsonlKnowledgeRepository;
}

function flattenCaptureResult(result: CaptureProjectKnowledgeResult): unknown {
  return {
    ...result.item,
    event: result.event
  };
}

function flattenTaskCaptureResult(result: CaptureProjectTaskResult): unknown {
  return {
    ...result.item,
    taskStatus: result.status,
    event: result.event
  };
}

function flattenRateResult(result: RateProjectKnowledgeResult): unknown {
  return {
    ...result.item,
    ratingEvent: result.rating,
    event: result.event
  };
}

function toCaptureInput(input: MeshCaptureKnowledgeInput): CaptureKnowledgeInput {
  const capture: CaptureKnowledgeInput = {
    type: input.type,
    title: input.title,
    summary: input.summary,
    layer: input.layer as KnowledgeLayer,
    tags: input.tags,
    visibility: input.visibility as KnowledgeVisibility,
    weight: input.weight
  };

  if (input.content !== undefined) {
    capture.content = input.content;
  }

  if (input.para !== undefined) {
    capture.para = input.para as ParaRef;
  }

  if (input.confidence !== undefined) {
    capture.confidence = input.confidence;
  }

  if (input.source !== undefined) {
    capture.source = {
      kind: input.source.kind
    };

    if (input.source.ref !== undefined) {
      capture.source.ref = input.source.ref;
    }

    if (input.source.url !== undefined) {
      capture.source.url = input.source.url;
    }

    if (input.source.commit !== undefined) {
      capture.source.commit = input.source.commit;
    }

    if (input.source.storageRef !== undefined) {
      capture.source.storageRef = input.source.storageRef;
    }

    if (input.source.metadata !== undefined) {
      capture.source.metadata = input.source.metadata;
    }
  }

  if (input.createdBy !== undefined) {
    capture.createdBy = {
      displayName: input.createdBy.displayName
    };

    if (input.createdBy.memberId !== undefined) {
      capture.createdBy.memberId = input.createdBy.memberId;
    }

    if (input.createdBy.handle !== undefined) {
      capture.createdBy.handle = input.createdBy.handle;
    }

    if (input.createdBy.clientId !== undefined) {
      capture.createdBy.clientId = input.createdBy.clientId;
    }
  }

  return capture;
}

function toProjectTaskCaptureInput(input: MeshCaptureTaskInput): CaptureProjectTaskInput {
  const capture: CaptureProjectTaskInput = {
    title: input.title,
    summary: input.summary,
    status: input.status,
    tags: input.tags
  };

  if (input.content !== undefined) {
    capture.content = input.content;
  }

  if (input.para !== undefined) {
    capture.para = input.para as ParaRef;
  }

  return capture;
}

function toTaskCaptureInput(input: MeshCaptureTaskInput): CaptureKnowledgeInput {
  const capture: CaptureKnowledgeInput = {
    type: 'task',
    title: input.title,
    summary: `[${input.status}] ${input.summary}`,
    layer: 'extract',
    tags: input.tags,
    source: { kind: 'task' },
    confidence: 0.55
  };

  if (input.content !== undefined) {
    capture.content = input.content;
  }

  if (input.para !== undefined) {
    capture.para = input.para as ParaRef;
  }

  return capture;
}

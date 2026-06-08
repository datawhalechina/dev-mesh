import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BuildContextPackInput } from '@mcp-dev-mesh/agent';
import type {
  CaptureKnowledgeInput,
  KnowledgeLayer,
  KnowledgeType,
  ParaRef,
  RateKnowledgeInput
} from '@mcp-dev-mesh/core';
import type { CaptureProjectTaskInput } from '@mcp-dev-mesh/local-store';
import {
  registerMeshTools,
  type MeshToolHandlers,
  type MeshCaptureKnowledgeInput,
  type MeshCaptureTaskInput,
  type MeshListDevelopmentSignalsInput,
  type MeshRateKnowledgeInput,
  type MeshSearchContextInput
} from '@mcp-dev-mesh/mcp-contracts';
import type { DevMeshClientRuntime } from './runtime.js';

export function createLocalMeshMcpServer(runtime: DevMeshClientRuntime): McpServer {
  return createLocalMeshMcpServerWithHandlers(createLocalMeshToolHandlers(runtime));
}

export function createLocalMeshMcpServerWithHandlers(handlers: MeshToolHandlers): McpServer {
  const mcp = new McpServer({
    name: 'mcp-dev-mesh-local',
    version: '0.1.0'
  });

  registerMeshTools(mcp, handlers);

  return mcp;
}

export function createLocalMeshToolHandlers(runtime: DevMeshClientRuntime): MeshToolHandlers {
  return {
    searchContext: (input) => runtime.searchContext(toContextPackInput(input)),
    captureKnowledge: (input) => runtime.captureKnowledge(toCaptureInput(input)),
    captureTask: (input) => runtime.captureTask(toTaskCaptureInput(input)),
    rateKnowledge: (input) => runtime.rateKnowledge(toRateInput(input)),
    listDevelopmentSignals: (input) => runtime.listDevelopmentSignals(toListDevelopmentSignalsInput(input)),
    searchMemberExperience(input) {
      return runtime.searchContext({
        ...toContextPackInput(input),
        authorName: input.memberName
      });
    },
    resolveTerm(input) {
      return runtime.core.searchKnowledge({
        query: input.term,
        types: ['glossary'],
        limit: input.limit
      });
    }
  };
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

function toCaptureInput(input: MeshCaptureKnowledgeInput): CaptureKnowledgeInput {
  const capture: CaptureKnowledgeInput = {
    type: input.type,
    title: input.title,
    summary: input.summary,
    layer: input.layer as KnowledgeLayer,
    tags: input.tags,
    visibility: input.visibility,
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

function toTaskCaptureInput(input: MeshCaptureTaskInput): CaptureProjectTaskInput {
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

function toListDevelopmentSignalsInput(input: MeshListDevelopmentSignalsInput): MeshListDevelopmentSignalsInput {
  return {
    limit: input.limit
  };
}

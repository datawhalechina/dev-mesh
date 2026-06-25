import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BuildContextPackInput } from '@devmesh/agent';
import type {
  CaptureKnowledgeInput,
  DeleteKnowledgeInput,
  KnowledgeLayer,
  KnowledgeType,
  ParaRef,
  RateKnowledgeInput,
  UpdateKnowledgeInput
} from '@devmesh/core';
import type { CaptureProjectTaskInput } from '@devmesh/local-store';
import { DEV_MESH_VERSION } from '@devmesh/shared';
import {
  DEV_MESH_MCP_INSTRUCTIONS,
  registerMeshTools,
  type MeshToolHandlers,
  type MeshBranchCreateInput,
  type MeshBranchPolicyInput,
  type MeshBranchSwitchInput,
  type MeshCaptureKnowledgeInput,
  type MeshCaptureTaskInput,
  type MeshDeleteKnowledgeInput,
  type MeshGraphPathInput,
  type MeshExploreKnowledgeGraphInput,
  type MeshGetProjectBriefInput,
  type MeshLinkKnowledgeInput,
  type MeshListKnowledgeInput,
  type MeshScanProjectKnowledgeInput,
  type MeshRateKnowledgeInput,
  type MeshSearchContextInput,
  type MeshUpdateKnowledgeInput
} from '@devmesh/mcp-contracts';
import { runDaemonSyncOnce } from './daemon-sync.js';
import type { DevMeshClientRuntime } from './runtime.js';

export function createLocalMeshMcpServer(runtime: DevMeshClientRuntime): McpServer {
  return createLocalMeshMcpServerWithHandlers(createLocalMeshToolHandlers(runtime));
}

export function createLocalMeshMcpServerWithHandlers(handlers: MeshToolHandlers): McpServer {
  const mcp = new McpServer(
    {
      name: 'devmesh-local',
      version: DEV_MESH_VERSION
    },
    {
      instructions: DEV_MESH_MCP_INSTRUCTIONS
    }
  );

  registerMeshTools(mcp, handlers, {
    capabilities: {
      power: true
    }
  });

  // Manual sync trigger
  mcp.registerTool(
    'mesh_trigger_sync',
    {
      title: 'Trigger manual sync',
      description: 'Immediately trigger a CRDT sync exchange with all joined remote servers.'
    },
    async (extra) => {
      const status = await runDaemonSyncOnce();
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    }
  );

  return mcp;
}

export function createLocalMeshToolHandlers(runtime: DevMeshClientRuntime): MeshToolHandlers {
  return {
    searchContext: (input) => runtime.searchContext(toContextPackInput(input)),
    listBranches: () => runtime.listBranches(),
    createBranch: (input) => runtime.createBranch(toBranchMutationInput(input)),
    switchBranch: (input) => runtime.switchBranch(toBranchMutationInput(input)),
    setBranchPolicy: (input) => runtime.setBranchPolicy(toBranchPolicyInput(input)),
    getKnowledge: (input) => runtime.getKnowledge(input.id),
    listKnowledge: (input) => runtime.listKnowledge(toListKnowledgeInput(input)),
    captureKnowledge: (input) => runtime.captureKnowledge(toCaptureInput(input)),
    updateKnowledge: (input) => runtime.updateKnowledge(toUpdateKnowledgeInput(input), toUpdateKnowledgeOptions(input)),
    deleteKnowledge: (input) => runtime.deleteKnowledge(toDeleteKnowledgeInput(input), toDeleteKnowledgeOptions(input)),
    captureTask: (input) => runtime.captureTask(toTaskCaptureInput(input)),
    rateKnowledge: (input) => runtime.rateKnowledge(toRateInput(input)),
    linkKnowledge: (input) => runtime.linkKnowledge(toLinkKnowledgeInput(input)),
    getStatus: () => runtime.status(),
    getProjectionStatus: () => runtime.projectionStatus(),
    rebuildProjection: () => runtime.rebuildProjectionsFromCrdt(),
    scanProjectKnowledge: (input) => runtime.scanProjectKnowledge(toScanProjectKnowledgeInput(input)),
    getProjectBrief: (input) => runtime.getProjectBrief(toGetProjectBriefInput(input)),
    exploreKnowledgeGraph: (input) => runtime.exploreKnowledgeGraph(toExploreKnowledgeGraphInput(input)),
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
    },
    graphPath(input: MeshGraphPathInput) {
      return runtime.findKnowledgeGraphPath(toGraphPathInput(input));
    }
  };
}

function toBranchMutationInput(
  input: MeshBranchCreateInput | MeshBranchSwitchInput
): Parameters<DevMeshClientRuntime['createBranch']>[0] {
  return {
    name: input.name,
    ...(input.policy === undefined ? {} : { policy: input.policy }),
    ...(input.base === undefined ? {} : { base: input.base })
  };
}

function toBranchPolicyInput(input: MeshBranchPolicyInput): Parameters<DevMeshClientRuntime['setBranchPolicy']>[0] {
  return {
    policy: input.policy,
    ...(input.branch === undefined ? {} : { name: input.branch })
  };
}

function toListKnowledgeInput(input: MeshListKnowledgeInput): Parameters<DevMeshClientRuntime['listKnowledge']>[0] {
  const filter: NonNullable<Parameters<DevMeshClientRuntime['listKnowledge']>[0]> = {
    includeSuperseded: input.includeSuperseded,
    limit: input.limit
  };

  if (input.branch !== undefined) {
    filter.branch = input.branch;
  }

  if (input.layers !== undefined) {
    filter.layers = input.layers as KnowledgeLayer[];
  }

  if (input.types !== undefined) {
    filter.types = input.types as KnowledgeType[];
  }

  if (input.para) {
    filter.para = input.para as Partial<ParaRef>;
  }

  if (input.authorName !== undefined) {
    filter.authorName = input.authorName;
  }

  if (input.tags !== undefined) {
    filter.tags = input.tags;
  }

  if (input.recencyDays !== undefined) {
    filter.recencyDays = input.recencyDays;
  }

  if (input.includeVolatile !== undefined) {
    filter.includeVolatile = input.includeVolatile;
  }

  return filter;
}

function toContextPackInput(input: MeshSearchContextInput): BuildContextPackInput {
  const search: BuildContextPackInput = {
    query: input.query,
    layers: input.layers as KnowledgeLayer[],
    limit: input.limit,
    includeSuperseded: input.includeSuperseded
  };

  if (input.branch !== undefined) {
    search.branch = input.branch;
  }

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

  if (input.includeVolatile !== undefined) {
    search.includeVolatile = input.includeVolatile;
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

function toUpdateKnowledgeInput(input: MeshUpdateKnowledgeInput): UpdateKnowledgeInput {
  const update: UpdateKnowledgeInput = {
    id: input.id
  };

  if (input.layer !== undefined) {
    update.layer = input.layer as KnowledgeLayer;
  }

  if (input.entryKey !== undefined) {
    update.entryKey = input.entryKey;
  }

  if (input.type !== undefined) {
    update.type = input.type;
  }

  if (input.title !== undefined) {
    update.title = input.title;
  }

  if (input.summary !== undefined) {
    update.summary = input.summary;
  }

  if (input.content !== undefined) {
    update.content = input.content;
  }

  if (input.para !== undefined) {
    update.para = input.para as ParaRef;
  }

  if (input.tags !== undefined) {
    update.tags = input.tags;
  }

  if (input.source !== undefined) {
    update.source = {
      kind: input.source.kind
    };

    if (input.source.ref !== undefined) {
      update.source.ref = input.source.ref;
    }

    if (input.source.url !== undefined) {
      update.source.url = input.source.url;
    }

    if (input.source.commit !== undefined) {
      update.source.commit = input.source.commit;
    }

    if (input.source.storageRef !== undefined) {
      update.source.storageRef = input.source.storageRef;
    }

    if (input.source.metadata !== undefined) {
      update.source.metadata = input.source.metadata;
    }
  }

  if (input.visibility !== undefined) {
    update.visibility = input.visibility;
  }

  if (input.status !== undefined) {
    update.status = input.status;
  }

  if (input.confidence !== undefined) {
    update.confidence = input.confidence;
  }

  if (input.weight !== undefined) {
    update.weight = input.weight;
  }

  return update;
}

function toUpdateKnowledgeOptions(
  input: MeshUpdateKnowledgeInput
): Parameters<DevMeshClientRuntime['updateKnowledge']>[1] {
  const options: NonNullable<Parameters<DevMeshClientRuntime['updateKnowledge']>[1]> = {};

  if (input.reason !== undefined) {
    options.reason = input.reason;
  }

  return options;
}

function toDeleteKnowledgeInput(input: MeshDeleteKnowledgeInput): DeleteKnowledgeInput {
  return {
    id: input.id
  };
}

function toDeleteKnowledgeOptions(
  input: MeshDeleteKnowledgeInput
): Parameters<DevMeshClientRuntime['deleteKnowledge']>[1] {
  const options: NonNullable<Parameters<DevMeshClientRuntime['deleteKnowledge']>[1]> = {};

  if (input.reason !== undefined) {
    options.reason = input.reason;
  }

  return options;
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

function toLinkKnowledgeInput(input: MeshLinkKnowledgeInput): Parameters<DevMeshClientRuntime['linkKnowledge']>[0] {
  const link: Parameters<DevMeshClientRuntime['linkKnowledge']>[0] = {
    kind: input.kind,
    fromId: input.fromId,
    toId: input.toId
  };

  if (input.reason !== undefined) {
    link.reason = input.reason;
  }

  return link;
}

function toScanProjectKnowledgeInput(input: MeshScanProjectKnowledgeInput): MeshScanProjectKnowledgeInput {
  return {
    limit: input.limit
  };
}

function toGetProjectBriefInput(input: MeshGetProjectBriefInput): { project?: string } {
  return {
    project: input.project
  };
}

function toGraphPathInput(
  input: MeshGraphPathInput
): NonNullable<Parameters<DevMeshClientRuntime['findKnowledgeGraphPath']>[0]> {
  const graphPath: NonNullable<Parameters<DevMeshClientRuntime['findKnowledgeGraphPath']>[0]> = {
    depth: input.depth,
    limit: input.limit
  };

  if (input.branch !== undefined) {
    graphPath.branch = input.branch;
  }

  if (input.sourceId !== undefined) {
    graphPath.sourceId = input.sourceId;
  }

  if (input.sourceQuery !== undefined) {
    graphPath.sourceQuery = input.sourceQuery;
  }

  if (input.targetId !== undefined) {
    graphPath.targetId = input.targetId;
  }

  if (input.targetQuery !== undefined) {
    graphPath.targetQuery = input.targetQuery;
  }

  if (input.nodeKinds !== undefined) {
    graphPath.nodeKinds = input.nodeKinds;
  }

  if (input.edgeKinds !== undefined) {
    graphPath.edgeKinds = input.edgeKinds;
  }

  return graphPath;
}

function toExploreKnowledgeGraphInput(
  input: MeshExploreKnowledgeGraphInput
): NonNullable<Parameters<DevMeshClientRuntime['exploreKnowledgeGraph']>[0]> {
  const graphInput: NonNullable<Parameters<DevMeshClientRuntime['exploreKnowledgeGraph']>[0]> = {
    depth: input.depth,
    limit: input.limit
  };

  if (input.branch !== undefined) {
    graphInput.branch = input.branch;
  }

  if (input.query !== undefined) {
    graphInput.query = input.query;
  }

  if (input.ids !== undefined) {
    graphInput.ids = input.ids;
  }

  if (input.nodeKinds !== undefined) {
    graphInput.nodeKinds = input.nodeKinds;
  }

  if (input.edgeKinds !== undefined) {
    graphInput.edgeKinds = input.edgeKinds;
  }

  return graphInput;
}

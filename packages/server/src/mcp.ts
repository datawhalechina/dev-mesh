import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createAgentContextService, type BuildContextPackInput } from '@devmesh/agent';
import type {
  CaptureKnowledgeInput,
  DeleteKnowledgeInput,
  DevMeshCore,
  KnowledgeFilter,
  KnowledgeLayer,
  KnowledgeType,
  KnowledgeVisibility,
  ParaRef,
  RateKnowledgeInput,
  UpdateKnowledgeInput
} from '@devmesh/core';
import { createDevMeshCore } from '@devmesh/core';
import { buildKnowledgeGraph, exploreKnowledgeGraph, findKnowledgeGraphPath, type KnowledgeGraphSemanticEdge } from '@devmesh/graph';
import { DEV_MESH_VERSION } from '@devmesh/shared';
import {
  DEV_MESH_MCP_INSTRUCTIONS,
  registerMeshTools,
  type MeshCaptureKnowledgeInput,
  type MeshCaptureTaskInput,
  type MeshDeleteKnowledgeInput,
  type MeshGraphPathInput,
  type MeshExploreKnowledgeGraphInput,
  type MeshLinkKnowledgeInput,
  type MeshListKnowledgeInput,
  type MeshRateKnowledgeInput,
  type MeshScanProjectKnowledgeInput,
  type MeshSearchContextInput,
  type MeshUpdateKnowledgeInput
} from '@devmesh/mcp-contracts';
import {
  captureProjectKnowledge,
  captureProjectTask,
  createProjectKnowledgeEdge,
  deleteProjectKnowledge,
  readProjectProjectionStatus,
  rebuildProjectProjectionsFromCrdt,
  JsonlKnowledgeRepository,
  rateProjectKnowledge,
  updateProjectKnowledge,
  type CaptureProjectKnowledgeResult,
  type CaptureProjectTaskInput,
  type CaptureProjectTaskResult,
  type DeleteProjectKnowledgeResult,
  type RateProjectKnowledgeResult,
  type UpdateProjectKnowledgeResult
} from '@devmesh/local-store';
import type { HubState } from './hub-state.js';
import {
  createAdminOverview,
  createAdminQualityReview,
  listAdminAuditLogs,
  listAdminMembers,
  listAdminKnowledgeEdges,
  listAdminReviewQueue
} from './hub-admin.js';
import { filterKnowledgeByGroup } from './hub-knowledge-scope.js';

interface ListKnowledgeRequest extends KnowledgeFilter {
  limit?: number;
}

export interface MeshMcpServerOptions {
  knowledgeEdges?: () => KnowledgeGraphSemanticEdge[] | Promise<KnowledgeGraphSemanticEdge[]>;
  linkKnowledge?: (input: MeshLinkKnowledgeInput) => Promise<unknown>;
  admin?: {
    hub: HubState;
    baseUrl: string;
  };
}

export function createMeshMcpServer(core: DevMeshCore, options: MeshMcpServerOptions = {}): McpServer {
  const mcp = new McpServer(
    {
      name: 'devmesh',
      version: DEV_MESH_VERSION
    },
    {
      instructions: DEV_MESH_MCP_INSTRUCTIONS
    }
  );

  registerMeshTools(mcp, {
    async getStatus() {
      const items = await core.listKnowledge({
        includeSuperseded: true
      });

      return {
        service: 'devmesh',
        version: DEV_MESH_VERSION,
        mode: isLocalStoreBacked(core) ? 'local-store' : 'server',
        projectRoot: core.projectRoot,
        repository: core.repository.constructor.name,
        knowledgeItems: items.length,
        activeBranch: 'main',
        branches: [
          {
            name: 'main',
            policy: 'balanced'
          }
        ]
      };
    },
    async getProjectionStatus() {
      if (isLocalStoreBacked(core)) {
        return readProjectProjectionStatus(core.projectRoot);
      }

      return {
        state: 'server_projection_pending',
        backend: 'hub-crdt',
        materialized: false,
        message: 'Hub CRDT projections will be materialized by the v2 global projection backend.'
      };
    },
    async rebuildProjection() {
      if (isLocalStoreBacked(core)) {
        return rebuildProjectProjectionsFromCrdt(core.projectRoot);
      }

      return {
        state: 'server_projection_pending',
        backend: 'hub-crdt',
        materialized: false,
        rebuilt: false,
        message: 'Hub CRDT projections will be materialized by the v2 global projection backend.'
      };
    },
    async listBranches() {
      return createServerBranchResult();
    },
    async createBranch(input) {
      return createServerBranchResult({
        active: 'main',
        branch: {
          name: input.name,
          active: false,
          base: false,
          policy: input.policy ?? 'balanced'
        },
        ...(input.base === undefined ? {} : { base: input.base })
      });
    },
    async switchBranch(input) {
      return createServerBranchResult({
        active: input.name,
        branch: {
          name: input.name,
          active: true,
          base: false,
          policy: input.policy ?? 'balanced'
        },
        ...(input.base === undefined ? {} : { base: input.base })
      });
    },
    async setBranchPolicy(input) {
      const name = input.branch ?? 'main';

      return createServerBranchResult({
        active: name,
        branch: {
          name,
          active: true,
          base: false,
          policy: input.policy
        }
      });
    },
    async searchContext(input) {
      if (input.branch !== undefined && !isLocalStoreBacked(core)) {
        return buildServerScopedContextPack(core, input);
      }

      return createAgentContextService({
        core: coreForBranch(input.branch, core)
      }).buildContextPack(toContextPackInput(input));
    },
    async getKnowledge(input) {
      const item = await core.getKnowledge(input.id);

      if (item === undefined) {
        return {
          found: false,
          id: input.id,
          message: `Knowledge item ${input.id} was not found.`
        };
      }

      return item;
    },
    async listKnowledge(input) {
      const { limit = 20, ...filter } = toListKnowledgeInput(input);
      const branchCore = coreForBranch(input.branch, core);
      const items = filterKnowledgeForMcpScope(await branchCore.listKnowledge(filter), input.branch, core);

      return {
        total: items.length,
        limit,
        items: items.slice(0, limit)
      };
    },
    async captureKnowledge(input) {
      const capture = toCaptureInput(input);

      if (isLocalStoreBacked(core)) {
        return flattenCaptureResult(await captureProjectKnowledge(core.projectRoot, capture));
      }

      return core.captureKnowledge(capture);
    },
    async updateKnowledge(input) {
      const update = toUpdateKnowledgeInput(input);

      if (isLocalStoreBacked(core)) {
        return flattenUpdateResult(await updateProjectKnowledge(core.projectRoot, core, update, toUpdateOptions(input)));
      }

      return core.updateKnowledge(update);
    },
    async deleteKnowledge(input) {
      const deletion = toDeleteKnowledgeInput(input);

      if (isLocalStoreBacked(core)) {
        return flattenDeleteResult(await deleteProjectKnowledge(core.projectRoot, core, deletion, toDeleteOptions(input)));
      }

      return core.deleteKnowledge(deletion);
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
    async linkKnowledge(input) {
      if (options.linkKnowledge !== undefined) {
        return options.linkKnowledge(input);
      }

      if (isLocalStoreBacked(core)) {
        return createProjectKnowledgeEdge(core.projectRoot, toProjectKnowledgeEdgeInput(input));
      }

      return {
        instruction:
          'Knowledge linking is only available when this MCP server is connected to a local project store or Hub knowledge edge backend.',
        input
      };
    },
    async searchMemberExperience(input) {
      if (input.branch !== undefined && !isLocalStoreBacked(core)) {
        return buildServerScopedContextPack(core, {
          ...input,
          authorName: input.memberName
        });
      }

      return createAgentContextService({
        core: coreForBranch(input.branch, core)
      }).buildContextPack({
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
    async scanProjectKnowledge(input: MeshScanProjectKnowledgeInput) {
      return {
        projectRoot: core.projectRoot,
        instruction: 'Project-wide scanning is only meaningful in the local daemon where Git and filesystem access are available.',
        limit: input.limit,
        findings: [],
        highlights: {
          changedFiles: [],
          fileCount: 0,
          todoFiles: []
        }
      };
    },
    async graphPath(input: MeshGraphPathInput) {
      const branchCore = coreForBranch(input.branch, core);
      const items = filterKnowledgeForMcpScope(await branchCore.listKnowledge({
        includeSuperseded: true
      }), input.branch, core);
      const semanticEdges = filterSemanticEdgesByGroup(await options.knowledgeEdges?.(), input.branch);
      const graph = buildKnowledgeGraph(
        items,
        semanticEdges === undefined
          ? {}
          : {
              semanticEdges
            }
      );

      return findKnowledgeGraphPath(graph, input);
    },
    async exploreKnowledgeGraph(input: MeshExploreKnowledgeGraphInput) {
      const branchCore = coreForBranch(input.branch, core);
      const items = filterKnowledgeForMcpScope(await branchCore.listKnowledge({
        includeSuperseded: true
      }), input.branch, core);
      const semanticEdges = filterSemanticEdgesByGroup(await options.knowledgeEdges?.(), input.branch);
      const graph = buildKnowledgeGraph(
        items,
        semanticEdges === undefined
          ? {}
          : {
              semanticEdges
            }
      );

      return exploreKnowledgeGraph(graph, input);
    },
    async adminGraphOverview(input) {
      if (options.admin === undefined) {
        return { instruction: 'Admin graph overview is not enabled for this MCP server.' };
      }

      return createAdminOverview(options.admin.hub, core, options.admin.baseUrl);
    },
    async adminMemberActivity(input) {
      if (options.admin === undefined) {
        return { instruction: 'Admin member activity is not enabled for this MCP server.' };
      }

      const auditQuery: Parameters<typeof listAdminAuditLogs>[1] = {
        limit: input.limit
      };

      if (input.branchKey !== undefined) {
        auditQuery.branchKey = input.branchKey;
      }

      return {
        members: listAdminMembers(options.admin.hub).filter((member) =>
          input.memberId === undefined ? true : member.memberId === input.memberId
        ),
        auditLogs: listAdminAuditLogs(options.admin.hub, auditQuery).auditLogs
      };
    },
    async adminQualityReview(input) {
      if (options.admin === undefined) {
        return { instruction: 'Admin quality review is not enabled for this MCP server.' };
      }

      const reviewQuery: Parameters<typeof createAdminQualityReview>[1] = {
        limit: input.limit
      };

      if (input.branchKey !== undefined) {
        reviewQuery.branchKey = input.branchKey;
      }

      if (input.projectKey !== undefined) {
        reviewQuery.groupKey = input.projectKey;
      }

      if (input.layer !== undefined) {
        reviewQuery.layer = input.layer;
      }

      return createAdminQualityReview(core, reviewQuery);
    },
    async adminConflictQueue(input) {
      if (options.admin === undefined) {
        return { instruction: 'Admin conflict queue is not enabled for this MCP server.' };
      }

      const edgeQuery: Parameters<typeof listAdminKnowledgeEdges>[1] = {
        limit: input.limit
      };

      if (input.branchKey !== undefined) {
        edgeQuery.branchKey = input.branchKey;
      }

      return {
        reviewQueue: listAdminReviewQueue(),
        knowledgeEdges: listAdminKnowledgeEdges(options.admin.hub, edgeQuery)
      };
    }
  }, {
    capabilities: {
      power: true,
      admin: options.admin !== undefined
    }
  });

  return mcp;
}

function createServerBranchResult(options: {
  active?: string;
  base?: string;
  branch?: { name: string; active: boolean; base: boolean; policy: string };
} = {}): unknown {
  const active = options.active ?? 'main';
  const branches = [
    {
      name: 'main',
      active: active === 'main',
      base: options.base === 'main',
      policy: 'balanced'
    }
  ];

  if (options.branch !== undefined && options.branch.name !== 'main') {
    branches.push(options.branch);
  }

  const result: {
    active: string;
    base?: string;
    branches: Array<{ name: string; active: boolean; base: boolean; policy: string }>;
    note: string;
  } = {
    active,
    branches,
    note: 'Server MCP exposes branch-shaped responses; durable branch membership is managed by Hub group APIs until CRDT v2 branch storage lands.'
  };

  if (options.base !== undefined) {
    result.base = options.base;
  }

  return result;
}

function toProjectKnowledgeEdgeInput(input: MeshLinkKnowledgeInput): Parameters<typeof createProjectKnowledgeEdge>[1] {
  const link: Parameters<typeof createProjectKnowledgeEdge>[1] = {
    kind: input.kind,
    fromId: input.fromId,
    toId: input.toId
  };

  if (input.reason !== undefined) {
    link.reason = input.reason;
  }

  return link;
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

  if (input.includeVolatile !== undefined) {
    search.includeVolatile = input.includeVolatile;
  }

  return search;
}

function toListKnowledgeInput(input: MeshListKnowledgeInput): ListKnowledgeRequest {
  const filter: ListKnowledgeRequest = {
    includeSuperseded: input.includeSuperseded,
    limit: input.limit
  };

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

function coreForBranch(branch: string | undefined, core: DevMeshCore): DevMeshCore {
  if (branch === undefined || !isLocalStoreBacked(core)) {
    return core;
  }

  return createDevMeshCore({
    projectRoot: core.projectRoot,
    repository: new JsonlKnowledgeRepository(core.projectRoot, {
      branchScope: {
        active: branch,
        readable: [branch]
      }
    })
  });
}

function filterKnowledgeForMcpScope<T extends { visibility: string; source: { metadata?: Record<string, unknown> } }>(
  items: T[],
  branch: string | undefined,
  core: DevMeshCore
): T[] {
  if (branch === undefined || isLocalStoreBacked(core)) {
    return items;
  }

  return filterKnowledgeByGroup(items as never, branch) as never;
}

async function buildServerScopedContextPack(core: DevMeshCore, input: MeshSearchContextInput): Promise<unknown> {
  const contextInput = toContextPackInput(input);
  const limit = contextInput.limit ?? 8;
  const searchInput: Parameters<DevMeshCore['searchKnowledge']>[0] = {
    query: contextInput.query,
    limit: Math.max(limit * 4, 20)
  };

  if (contextInput.layers !== undefined) {
    searchInput.layers = contextInput.layers;
  }

  if (contextInput.types !== undefined) {
    searchInput.types = contextInput.types;
  }

  if (contextInput.authorName !== undefined) {
    searchInput.authorName = contextInput.authorName;
  }

  if (contextInput.para !== undefined) {
    searchInput.para = contextInput.para;
  }

  if (contextInput.recencyDays !== undefined) {
    searchInput.recencyDays = contextInput.recencyDays;
  }

  if (contextInput.includeSuperseded !== undefined) {
    searchInput.includeSuperseded = contextInput.includeSuperseded;
  }

  if (contextInput.includeVolatile !== undefined) {
    searchInput.includeVolatile = contextInput.includeVolatile;
  }

  const candidates = filterKnowledgeByGroup(await core.searchKnowledge(searchInput), input.branch).slice(0, limit);
  const scopedCore = createDevMeshCore({
    projectRoot: core.projectRoot
  });

  await Promise.all(candidates.map((item) => scopedCore.repository.upsert(item)));

  return createAgentContextService({
    core: scopedCore
  }).buildContextPack(contextInput);
}

function filterSemanticEdgesByGroup(
  edges: KnowledgeGraphSemanticEdge[] | undefined,
  groupKey: string | undefined
): KnowledgeGraphSemanticEdge[] | undefined {
  if (edges === undefined || groupKey === undefined) {
    return edges;
  }

  return edges.filter((edge) => {
    const scoped = edge as KnowledgeGraphSemanticEdge & { groupKey?: string };
    return scoped.groupKey === undefined || scoped.groupKey === groupKey;
  });
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

function flattenUpdateResult(result: UpdateProjectKnowledgeResult): unknown {
  return {
    ...result.item,
    event: result.event
  };
}

function flattenDeleteResult(result: DeleteProjectKnowledgeResult): unknown {
  return {
    ...result.item,
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

function toUpdateOptions(input: MeshUpdateKnowledgeInput): Parameters<typeof updateProjectKnowledge>[3] {
  const options: NonNullable<Parameters<typeof updateProjectKnowledge>[3]> = {};

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

function toDeleteOptions(input: MeshDeleteKnowledgeInput): Parameters<typeof deleteProjectKnowledge>[3] {
  const options: NonNullable<Parameters<typeof deleteProjectKnowledge>[3]> = {};

  if (input.reason !== undefined) {
    options.reason = input.reason;
  }

  return options;
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

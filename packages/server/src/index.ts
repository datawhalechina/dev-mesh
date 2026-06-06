import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import Fastify, { type FastifyInstance } from 'fastify';
import type {
  CaptureKnowledgeInput,
  DevMeshCore,
  KnowledgeLayer,
  RateKnowledgeInput,
  SearchKnowledgeInput,
  KnowledgeType,
  KnowledgeVisibility,
  ParaRef
} from '@mcp-dev-mesh/core';
import { createDefaultWellKnown, type JoinRequest, type SyncPushRequest } from '@mcp-dev-mesh/protocol';
import {
  registerMeshTools,
  type MeshCaptureKnowledgeInput,
  type MeshCaptureTaskInput,
  type MeshRateKnowledgeInput,
  type MeshSearchContextInput
} from '@mcp-dev-mesh/mcp-contracts';

export interface MeshServerOptions {
  core: DevMeshCore;
  baseUrl?: string;
  logger?: boolean;
}

export interface MeshListenOptions {
  host?: string;
  port?: number;
}

export function createMeshMcpServer(core: DevMeshCore): McpServer {
  const mcp = new McpServer({
    name: 'mcp-dev-mesh',
    version: '0.1.0'
  });

  registerMeshTools(mcp, {
    async searchContext(input) {
      return core.searchKnowledge(toSearchInput(input));
    },
    async captureKnowledge(input) {
      return core.captureKnowledge(toCaptureInput(input));
    },
    async captureTask(input) {
      return core.captureKnowledge(toTaskCaptureInput(input));
    },
    async rateKnowledge(input) {
      return core.rateKnowledge(toRateInput(input));
    },
    async searchMemberExperience(input) {
      return core.searchKnowledge({
        ...toSearchInput(input),
        authorName: input.memberName
      });
    },
    async resolveTerm(input) {
      return core.searchKnowledge({
        query: input.term,
        types: ['glossary'],
        limit: input.limit
      });
    }
  });

  return mcp;
}

export async function createHubServer(options: MeshServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:8721';
  const mcp = createMeshMcpServer(options.core);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
  let connected = false;

  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'mcp-dev-mesh',
    version: '0.1.0'
  }));

  app.get('/.well-known/dev-mesh', async () => createDefaultWellKnown(baseUrl));

  app.get('/api/v1/groups', async () => ({
    groups: []
  }));

  app.post('/api/v1/join', async (request) => {
    const body = request.body as JoinRequest;
    const groupKey = body.groupKey ?? 'default';
    const handle = body.handle ?? slugHandle(body.displayName);

    return {
      memberId: `member_${handle}`,
      clientId: `client_${handle}`,
      groupKey,
      accessToken: `local_${groupKey}_${handle}`
    };
  });

  app.post('/api/v1/sync/push', async (request) => {
    const body = request.body as SyncPushRequest;

    return {
      accepted: body.events.length,
      rejected: [],
      cursor: `cur_${Date.now().toString(36)}`
    };
  });

  app.get('/api/v1/sync/pull', async (request) => {
    const query = request.query as { cursor?: string };

    return {
      cursor: query.cursor ?? `cur_${Date.now().toString(36)}`,
      events: []
    };
  });

  app.get('/api/v1/projects', async () => ({
    projects: []
  }));

  app.post('/api/v1/projects', async (request) => ({
    project: request.body
  }));

  app.get('/api/v1/projects/:id/brief', async (request) => {
    const params = request.params as { id: string };
    const items = await options.core.searchKnowledge({
      query: params.id,
      layers: ['canonical'],
      limit: 5
    });

    return {
      projectId: params.id,
      items
    };
  });

  app.get('/api/v1/admin/audit', async () => ({
    auditLogs: []
  }));

  app.route({
    method: ['GET', 'POST'],
    url: '/mcp',
    handler: async (request, reply) => {
      if (!connected) {
        // The SDK transport callback types currently conflict with exactOptionalPropertyTypes.
        await mcp.connect(transport as never);
        connected = true;
      }

      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
    }
  });

  return app;
}

export async function listenMeshServer(app: FastifyInstance, options: MeshListenOptions = {}): Promise<string> {
  const port = options.port ?? 8721;
  const host = options.host ?? '127.0.0.1';
  await app.listen({ port, host });
  return `http://${host}:${port}`;
}

function toSearchInput(input: MeshSearchContextInput): SearchKnowledgeInput {
  const search: SearchKnowledgeInput = {
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

function slugHandle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyProjectCrdtChanges,
  captureProjectKnowledge,
  createProjectKnowledgeEdge,
  ensureProjectStore,
  exploreProjectGraph,
  importProjectJsonlToCrdt,
  JsonlKnowledgeRepository,
  loadBranchKnowledgeItemsFromCrdt,
  loadProjectKnowledgeItemsFromCrdt,
  readBranchCrdtSyncState,
  readProjectCrdtChangesSince,
  readProjectCrdtSyncState,
  readProjectProjectionStatus,
  rebuildProjectProjectionsFromCrdt,
  readProjectConfig,
  writeProjectConfig
} from '@devmesh/local-store';
import {
  readDaemonSyncHeads,
  readDaemonSyncStatus,
  runDaemonSyncOnce,
  startDaemonSyncWorker
} from '../src/daemon-sync.js';

describe('daemon sync', () => {
  it('exchanges local and remote CRDT changes and records sync status', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-sync-project-'));
    const remoteRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-sync-remote-'));
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-sync-global-'));
    const checkedAt = '2026-06-08T00:00:00.000Z';
    const projectKey = 'frontend-app';
    const joinedServer = {
      serverUrl: 'http://mesh.test',
      mcpUrl: 'http://mesh.test/mcp',
      groupKey: 'frontend-team',
      memberId: 'member_frontend-team_xiaoyun',
      clientId: 'client_frontend-team_xiaoyun_abc123',
      displayName: 'Xiaoyun',
      joinedAt: '2026-06-07T00:00:00.000Z',
      accessToken: 'mesh_secret_token',
      syncSigningSecret: 'sync_secret_value'
    };
    const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];

    try {
      await ensureProjectStore(projectRoot, {
        projectKey
      });
      await ensureProjectStore(remoteRoot, {
        projectKey
      });
      const localCapture = await captureProjectKnowledge(
        projectRoot,
        {
          id: 'kn_local_1',
          type: 'decision',
          title: 'Daemon sync captures local events',
          summary: 'Daemon sync should include a replayable knowledge snapshot.',
          layer: 'canonical',
          tags: ['sync']
        },
        {
          projectKey
        }
      );
      const remoteCapture = await captureProjectKnowledge(
        remoteRoot,
        {
          id: 'kn_remote_1',
          type: 'decision',
          title: 'Remote team context',
          summary: 'Use the shared shell command wrapper before release checks.',
          content: 'Run focused verification through the shared wrapper so logs stay consistent.',
          layer: 'canonical',
          tags: ['remote', 'release'],
          createdAt: '2026-06-08T00:01:00.000Z',
          createdBy: {
            displayName: 'Ayuan',
            clientId: 'client_frontend-team_ayuan_def456'
          },
          visibility: 'team'
        },
        {
          projectKey
        }
      );
      await writeFile(
        join(globalRoot, 'identity.json'),
        `${JSON.stringify({ joinedServers: [joinedServer] }, null, 2)}\n`,
        'utf8'
      );

      const fetchStub = async (input: string | URL, init?: RequestInit): Promise<Response> => {
        const url = input.toString();
        const method = init?.method ?? 'GET';
        const body =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;

        requests.push({
          url,
          method,
          body
        });

        if (url === 'http://mesh.test/api/v2/sync/exchange') {
          const request = body as TestCrdtSyncRequest;

          expect(init?.headers).toMatchObject({
            authorization: 'Bearer mesh_secret_token'
          });
          expect(body).toMatchObject({
            clientId: joinedServer.clientId,
            projectKey,
            document: {
              kind: 'project',
              groupKey: joinedServer.groupKey,
              projectKey,
              schemaVersion: 2
            }
          });
          expect(request.heads).toEqual(expect.any(Array));
          expect(request.changes.length).toBeGreaterThanOrEqual(0);

          const remoteChanges = await readProjectCrdtChangesSince(remoteRoot, request.heads, {
            projectKey
          });

          await applyProjectCrdtChanges(remoteRoot, request.changes.map(decodeTestCrdtChange), {
            projectKey
          });
          const remoteState = await readProjectCrdtSyncState(remoteRoot, {
            projectKey
          });

          return jsonResponse({
            document: request.document,
            acceptedChanges: request.changes.map((change) => ({
              id: change.id,
              headsAfter: remoteState.heads
            })),
            rejected: [],
            heads: remoteState.heads,
            changes: remoteChanges.changes.map(toTestCrdtSyncChange),
            projection: {
              materialized: true,
              sourceHeads: remoteState.heads,
              updatedAt: checkedAt
            }
          });
        }

        return jsonResponse(
          {
            error: {
              code: 'not_found',
              message: `Unexpected URL ${url}`
            }
          },
          { status: 404 }
        );
      };

      const status = await runDaemonSyncOnce({
        projectRoot,
        globalRoot,
        now: () => new Date(checkedAt),
        fetch: fetchStub
      });
      const secondStatus = await runDaemonSyncOnce({
        projectRoot,
        globalRoot,
        now: () => new Date(checkedAt),
        fetch: fetchStub
      });
      const peers = JSON.parse(await readFile(join(projectRoot, '.dev-mesh', 'crdt', 'sync', 'peers.json'), 'utf8')) as {
        schemaVersion: 2;
        remotes: Record<string, { remoteHeads: string[]; lastExchangeHeads: string[]; lastExchangeAt: string }>;
      };
      const heads = JSON.parse(await readFile(join(projectRoot, '.dev-mesh', 'crdt', 'sync', 'heads.json'), 'utf8')) as {
        schemaVersion: 2;
        updatedAt: string;
        localHeads: string[];
        projectionSourceHeads: string[];
        materialized: boolean;
        remotes: Record<
          string,
          {
            remoteHeads: string[];
            lastExchangeHeads: string[];
            queuedLocalChanges: number;
            exchangeComplete: boolean;
            lastExchangeAt: string;
          }
        >;
      };
      const storedStatus = await readDaemonSyncStatus(projectRoot);
      const storedHeads = await readDaemonSyncHeads(projectRoot);
      const remotePeer = Object.values(peers.remotes)[0];
      const remoteHeads = Object.values(heads.remotes)[0];
      const localItems = await loadProjectKnowledgeItemsFromCrdt(projectRoot, {
        projectKey
      });
      const remoteState = await readProjectCrdtSyncState(remoteRoot, {
        projectKey
      });
      const firstRequest = requests[0]?.body as TestCrdtSyncRequest | undefined;
      const secondRequest = requests[1]?.body as TestCrdtSyncRequest | undefined;

      if (firstRequest === undefined || secondRequest === undefined || remotePeer === undefined || remoteHeads === undefined) {
        throw new Error('Expected two CRDT exchange requests and one remote peer.');
      }

      expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        'POST http://mesh.test/api/v2/sync/exchange',
        'POST http://mesh.test/api/v2/sync/exchange'
      ]);
      expect(firstRequest.changes.length).toBeGreaterThan(0);
      expect(firstRequest.changes[0]).toMatchObject({
        engine: 'automerge',
        encoding: 'base64',
        headsBefore: [],
        headsAfter: firstRequest.heads
      });
      expect(secondRequest.changes).toHaveLength(0);
      expect(peers.schemaVersion).toBe(2);
      expect(remotePeer).toMatchObject({
        remoteHeads: remoteState.heads,
        lastExchangeHeads: remoteState.heads,
        lastExchangeAt: checkedAt
      });
      expect(heads).toMatchObject({
        schemaVersion: 2,
        updatedAt: checkedAt,
        localHeads: remoteState.heads,
        projectionSourceHeads: remoteState.heads,
        materialized: true
      });
      expect(remoteHeads).toMatchObject({
        remoteHeads: remoteState.heads,
        lastExchangeHeads: remoteState.heads,
        queuedLocalChanges: 0,
        exchangeComplete: true,
        lastExchangeAt: checkedAt
      });
      expect(localItems.map((item) => item.id)).toEqual(expect.arrayContaining([localCapture.item.id, remoteCapture.item.id]));
      expect(status).toMatchObject({
        schemaVersion: 2,
        enabled: true,
        crdt: {
          initialized: true,
          materialized: true,
          projectionState: 'ready',
          currentHeads: remoteState.heads,
          projectionSourceHeads: remoteState.heads
        },
        projection: {
          state: 'ready',
          materialized: true,
          documentCount: 2,
          fileSummary: {
            corrupt: 0,
            missing: 0,
            schemaMismatch: 0
          }
        },
        remotes: [
          {
            serverUrl: joinedServer.serverUrl,
            groupKey: joinedServer.groupKey,
            clientId: joinedServer.clientId,
            queuedLocalChanges: 0,
            pushedChanges: firstRequest.changes.length,
            pulledChanges: expect.any(Number),
            appliedChanges: expect.any(Number),
            rejectedChanges: 0,
            localHeads: remoteState.heads,
            remoteHeads: remoteState.heads,
            exchangeComplete: true,
            lastExchangeAt: checkedAt
          }
        ]
      });
      expect(secondStatus).toMatchObject({
        remotes: [
          {
            queuedLocalChanges: 0,
            pushedChanges: 0,
            pulledChanges: 0,
            appliedChanges: 0,
            rejectedChanges: 0,
            localHeads: remoteState.heads,
            remoteHeads: remoteState.heads,
            exchangeComplete: true,
            lastExchangeAt: checkedAt
          }
        ]
      });
      expect(storedStatus).toMatchObject(secondStatus);
      expect(storedHeads).toMatchObject(heads);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(remoteRoot, { recursive: true, force: true });
      await rm(globalRoot, { recursive: true, force: true });
    }
  });

  it('rebuilds CRDT projections before checking remote sync', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-projection-project-'));
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-projection-global-'));

    try {
      await ensureProjectStore(projectRoot);
      await captureProjectKnowledge(projectRoot, {
        id: 'kn_projection_daemon_1',
        type: 'decision',
        title: 'Daemon keeps CRDT projections ready',
        summary: 'The daemon should rebuild read models when CRDT heads are ahead of projection metadata.',
        layer: 'canonical',
        tags: ['projection', 'daemon']
      });
      const imported = await importProjectJsonlToCrdt(projectRoot, {
        actorId: 'da0f00d0'
      });

      await expect(readProjectProjectionStatus(projectRoot)).resolves.toMatchObject({
        state: 'missing'
      });

      const status = await runDaemonSyncOnce({
        projectRoot,
        globalRoot,
        now: () => new Date('2026-06-09T00:00:00.000Z')
      });
      const projection = await readProjectProjectionStatus(projectRoot);
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const search = await repository.search({
        query: 'CRDT projections ready',
        layers: ['canonical']
      });

      expect(status).toMatchObject({
        schemaVersion: 2,
        enabled: true,
        crdt: {
          initialized: true,
          materialized: true,
          projectionState: 'ready',
          currentHeads: imported.heads,
          projectionSourceHeads: imported.heads
        },
        remotes: [],
        projection: {
          checkedAt: '2026-06-09T00:00:00.000Z',
          previousState: 'missing',
          state: 'ready',
          rebuilt: true,
          materialized: true,
          currentHeadCount: imported.heads.length,
          sourceHeadCount: imported.heads.length,
          fileSummary: {
            total: expect.any(Number),
            ready: expect.any(Number),
            missing: 0,
            corrupt: 0,
            schemaMismatch: 0
          },
          documentCount: 1
        }
      });
      expect(projection).toMatchObject({
        state: 'ready',
        documentCount: 1
      });
      expect(search.map((item) => item.id)).toContain('kn_projection_daemon_1');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(globalRoot, { recursive: true, force: true });
    }
  });

  it('syncs only the active knowledge branch group', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-active-branch-project-'));
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-active-branch-global-'));
    const checkedAt = '2026-06-09T00:03:00.000Z';
    const projectKey = 'branch-aware-app';
    const joinedServers = [
      createJoinedServerRecord('frontend', 'frontend-team'),
      createJoinedServerRecord('backend', 'backend-team'),
      createJoinedServerRecord('default', 'default')
    ];
    const requests: TestCrdtSyncRequest[] = [];

    try {
      await ensureProjectStore(projectRoot, {
        projectKey
      });
      const config = await readProjectConfig(projectRoot);
      config.knowledgeBranch.active = 'frontend-team';
      config.knowledgeBranch.base = 'shared';
      config.knowledgeBranch.branches = [
        {
          name: 'frontend-team',
          policy: 'frontend_design'
        },
        {
          name: 'shared',
          policy: 'durable_only'
        },
        {
          name: 'backend-team',
          policy: 'backend_design'
        },
        {
          name: 'main',
          policy: 'balanced'
        }
      ];
      await writeProjectConfig(projectRoot, config);
      await captureProjectKnowledge(
        projectRoot,
        {
          id: 'kn_active_branch_sync',
          type: 'decision',
          title: 'Active branch sync target',
          summary: 'Daemon sync should exchange CRDT changes only with the checked-out knowledge branch group.',
          layer: 'canonical',
          tags: ['branch', 'sync']
        },
        {
          projectKey,
          branch: 'frontend-team'
        }
      );
      await writeFile(
        join(globalRoot, 'identity.json'),
        `${JSON.stringify({ joinedServers }, null, 2)}\n`,
        'utf8'
      );

      const fetchStub = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
        const body =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as TestCrdtSyncRequest) : undefined;

        if (body === undefined) {
          throw new Error('Expected CRDT exchange body.');
        }

        requests.push(body);

        return jsonResponse({
          document: body.document,
          acceptedChanges: body.changes.map((change) => ({
            id: change.id,
            headsAfter: body.heads
          })),
          rejected: [],
          heads: body.heads,
          changes: [],
          projection: {
            materialized: true,
            sourceHeads: body.heads,
            updatedAt: checkedAt
          }
        });
      };

      const status = await runDaemonSyncOnce({
        projectRoot,
        globalRoot,
        now: () => new Date(checkedAt),
        fetch: fetchStub
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        clientId: 'client_frontend_frontend-team',
        projectKey,
        document: {
          kind: 'project',
          groupKey: 'frontend-team',
          projectKey,
          schemaVersion: 2
        }
      });
      expect(status.remotes).toEqual([
        expect.objectContaining({
          serverUrl: 'http://frontend.mesh.test',
          groupKey: 'frontend-team',
          clientId: 'client_frontend_frontend-team',
          branchRole: 'active',
          readOnly: false,
          enabled: true
        })
      ]);
      expect(status.message).toBe('Daemon sync checked 1 remote(s).');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(globalRoot, { recursive: true, force: true });
    }
  });

  it('negotiates the base knowledge branch as read-only', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-base-branch-project-'));
    const remoteRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-base-branch-remote-'));
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-base-branch-global-'));
    const checkedAt = '2026-06-09T00:04:00.000Z';
    const projectKey = 'base-aware-app';
    const joinedServers = [
      createJoinedServerRecord('frontend', 'frontend-team'),
      createJoinedServerRecord('shared', 'shared')
    ];
    const requests: TestCrdtSyncRequest[] = [];

    try {
      await ensureProjectStore(projectRoot, {
        projectKey
      });
      await ensureProjectStore(remoteRoot, {
        projectKey
      });
      const config = await readProjectConfig(projectRoot);
      const remoteConfig = await readProjectConfig(remoteRoot);
      config.knowledgeBranch.active = 'frontend-team';
      config.knowledgeBranch.base = 'shared';
      config.knowledgeBranch.branches = [
        {
          name: 'frontend-team',
          policy: 'frontend_design'
        },
        {
          name: 'shared',
          policy: 'durable_only'
        }
      ];
      remoteConfig.knowledgeBranch.active = 'shared';
      remoteConfig.knowledgeBranch.branches = [
        {
          name: 'shared',
          policy: 'durable_only'
        }
      ];
      await writeProjectConfig(projectRoot, config);
      await writeProjectConfig(remoteRoot, remoteConfig);
      await captureProjectKnowledge(
        projectRoot,
        {
          id: 'kn_base_branch_read_only',
          type: 'decision',
          title: 'Base branch remains read-only',
          summary: 'Daemon sync should not upload active branch CRDT changes into the base branch group.',
          layer: 'canonical',
          tags: ['branch', 'sync']
        },
        {
          projectKey,
          branch: 'frontend-team'
        }
      );
      const sharedBase = await captureProjectKnowledge(
        remoteRoot,
        {
          id: 'kn_shared_base_branch',
          type: 'decision',
          title: 'Shared base branch context',
          summary: 'Base branch context should be cached separately from the active branch document.',
          layer: 'canonical',
          tags: ['branch', 'base']
        },
        {
          projectKey,
          branch: 'shared'
        }
      );
      const sharedBaseSuperseded = await captureProjectKnowledge(
        remoteRoot,
        {
          id: 'kn_shared_base_superseded',
          type: 'decision',
          title: 'Older shared branch context',
          summary: 'Shared branch graph edges should also be cached for base branch graph exploration.',
          layer: 'canonical',
          tags: ['branch', 'base', 'graph']
        },
        {
          projectKey,
          branch: 'shared'
        }
      );
      await createProjectKnowledgeEdge(
        remoteRoot,
        {
          fromId: sharedBase.item.id,
          toId: sharedBaseSuperseded.item.id,
          kind: 'supersedes',
          reason: 'The newer shared context replaces the older shared context.'
        },
        {
          projectKey,
          branch: 'shared'
        }
      );
      const baseRemoteChanges = await readProjectCrdtChangesSince(remoteRoot, [], {
        projectKey
      });
      await writeFile(
        join(globalRoot, 'identity.json'),
        `${JSON.stringify({ joinedServers }, null, 2)}\n`,
        'utf8'
      );

      const fetchStub = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
        const body =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as TestCrdtSyncRequest) : undefined;

        if (body === undefined) {
          throw new Error('Expected CRDT exchange body.');
        }

        requests.push(body);

        return jsonResponse({
          document: body.document,
          acceptedChanges: body.changes.map((change) => ({
            id: change.id,
            headsAfter: body.heads
          })),
          rejected: [],
          heads: body.document.groupKey === 'shared' ? baseRemoteChanges.heads : body.heads,
          changes:
            body.document.groupKey === 'shared'
              ? baseRemoteChanges.changes.map(toTestCrdtSyncChange)
              : [],
          projection: {
            materialized: true,
            sourceHeads: body.heads,
            updatedAt: checkedAt
          }
        });
      };

      const status = await runDaemonSyncOnce({
        projectRoot,
        globalRoot,
        now: () => new Date(checkedAt),
        fetch: fetchStub
      });
      const syncHeads = await readDaemonSyncHeads(projectRoot);
      const baseCache = await readBranchCrdtSyncState(projectRoot, 'shared', {
        projectKey
      });
      const activeItems = await loadProjectKnowledgeItemsFromCrdt(projectRoot, {
        projectKey
      });
      const baseItems = await loadBranchKnowledgeItemsFromCrdt(projectRoot, 'shared', {
        projectKey
      });
      await rebuildProjectProjectionsFromCrdt(projectRoot, {
        projectKey
      });
      const repository = new JsonlKnowledgeRepository(projectRoot);
      const visibleSearch = await repository.search({
        query: 'Shared base branch context',
        limit: 5
      });
      const visibleBaseItem = await repository.get('kn_shared_base_branch');
      const graph = await exploreProjectGraph(projectRoot, {
        ids: ['kn_shared_base_branch'],
        edgeKinds: ['supersedes'],
        limit: 10
      });

      expect(requests).toHaveLength(2);
      expect(requests.map((request) => request.document.groupKey)).toEqual(['frontend-team', 'shared']);
      expect(requests[0].changes.length).toBeGreaterThan(0);
      expect(requests[1]).toMatchObject({
        clientId: 'client_shared_shared',
        projectKey,
        document: {
          kind: 'project',
          groupKey: 'shared',
          projectKey,
          schemaVersion: 2
        },
        heads: [],
        changes: []
      });
      expect(status.remotes).toEqual([
        expect.objectContaining({
          groupKey: 'frontend-team',
          branchRole: 'active',
          readOnly: false,
          pushedChanges: requests[0].changes.length
        }),
        expect.objectContaining({
          groupKey: 'shared',
          branchRole: 'base',
          readOnly: true,
          queuedLocalChanges: 0,
          pushedChanges: 0,
          pulledChanges: baseRemoteChanges.changes.length,
          appliedChanges: baseRemoteChanges.changes.length,
          cachePath: baseCache.path,
          cacheInitialized: true,
          cacheHeadCount: baseRemoteChanges.heads.length,
          cacheChangeCount: baseRemoteChanges.changeCount,
          localHeads: baseRemoteChanges.heads,
          remoteHeads: baseRemoteChanges.heads
        })
      ]);
      expect(baseCache).toMatchObject({
        initialized: true,
        heads: baseRemoteChanges.heads,
        changeCount: baseRemoteChanges.changeCount
      });
      expect(Object.values(syncHeads?.remotes ?? {})).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            groupKey: 'shared',
            branchRole: 'base',
            readOnly: true,
            cachePath: baseCache.path,
            cacheInitialized: true,
            cacheHeadCount: baseRemoteChanges.heads.length,
            cacheChangeCount: baseRemoteChanges.changeCount
          })
        ])
      );
      expect(activeItems.map((item) => item.id)).not.toContain('kn_shared_base_branch');
      expect(baseItems.map((item) => item.id)).toContain('kn_shared_base_branch');
      expect(visibleSearch.map((item) => item.id)).toContain('kn_shared_base_branch');
      expect(visibleBaseItem).toMatchObject({
        id: 'kn_shared_base_branch',
        source: {
          metadata: expect.objectContaining({
            branch: 'shared'
          })
        }
      });
      expect(graph.nodes.map((node) => node.id)).toEqual(
        expect.arrayContaining(['knowledge:kn_shared_base_branch', 'knowledge:kn_shared_base_superseded'])
      );
      expect(graph.edges).toEqual([
        expect.objectContaining({
          from: 'knowledge:kn_shared_base_branch',
          to: 'knowledge:kn_shared_base_superseded',
          kind: 'supersedes'
        })
      ]);
      expect(status.message).toBe('Daemon sync checked 2 remote(s).');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(remoteRoot, { recursive: true, force: true });
      await rm(globalRoot, { recursive: true, force: true });
    }
  });

  it('repairs damaged CRDT projections during daemon sync', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-projection-repair-project-'));
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-projection-repair-global-'));

    try {
      await ensureProjectStore(projectRoot);
      await captureProjectKnowledge(projectRoot, {
        id: 'kn_projection_daemon_repair_1',
        type: 'decision',
        title: 'Daemon repairs damaged projections',
        summary: 'The daemon should rebuild read models when a projection file is corrupt.',
        layer: 'canonical',
        tags: ['projection', 'daemon']
      });
      await importProjectJsonlToCrdt(projectRoot, {
        actorId: 'da0f00d0'
      });
      const rebuilt = await rebuildProjectProjectionsFromCrdt(projectRoot);

      await writeFile(rebuilt.graphPath, '{', 'utf8');
      await expect(readProjectProjectionStatus(projectRoot)).resolves.toMatchObject({
        state: 'corrupt'
      });

      const status = await runDaemonSyncOnce({
        projectRoot,
        globalRoot,
        now: () => new Date('2026-06-09T00:05:00.000Z')
      });

      expect(status).toMatchObject({
        schemaVersion: 2,
        crdt: {
          initialized: true,
          materialized: true,
          projectionState: 'ready'
        },
        projection: {
          checkedAt: '2026-06-09T00:05:00.000Z',
          previousState: 'corrupt',
          state: 'ready',
          rebuilt: true,
          materialized: true,
          fileSummary: {
            corrupt: 0,
            missing: 0,
            schemaMismatch: 0
          },
          documentCount: 1
        }
      });
      await expect(readProjectProjectionStatus(projectRoot)).resolves.toMatchObject({
        state: 'ready',
        documentCount: 1
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(globalRoot, { recursive: true, force: true });
    }
  });

  it('debounces CRDT file changes and rebuilds projections without waiting for the interval', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-watch-project-'));
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-watch-global-'));
    let worker: ReturnType<typeof startDaemonSyncWorker> | undefined;

    try {
      await ensureProjectStore(projectRoot);
      worker = startDaemonSyncWorker({
        projectRoot,
        globalRoot,
        intervalMs: 60_000,
        debounceMs: 50,
        onError(error) {
          throw error;
        }
      });
      await waitForDaemonStatus(projectRoot);

      await captureProjectKnowledge(projectRoot, {
        id: 'kn_daemon_watch_1',
        type: 'decision',
        title: 'Watcher rebuilds CRDT projections',
        summary: 'The daemon should react to CRDT file changes before the polling interval.',
        layer: 'canonical',
        tags: ['daemon', 'watch']
      });

      await waitForProjectionDocument(projectRoot, 'kn_daemon_watch_1');
      const status = await readDaemonSyncStatus(projectRoot);

      expect(status).toMatchObject({
        projection: {
          state: 'ready',
          rebuilt: true,
          documentCount: 1
        },
        crdt: {
          materialized: true,
          projectionState: 'ready'
        }
      });
    } finally {
      worker?.stop();
      await rm(projectRoot, { recursive: true, force: true });
      await rm(globalRoot, { recursive: true, force: true });
    }
  });

  it('normalizes legacy daemon sync status files to v2 shape', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-legacy-status-project-'));

    try {
      await ensureProjectStore(projectRoot);
      await mkdir(join(projectRoot, '.dev-mesh', 'state'), { recursive: true });
      await writeFile(
        join(projectRoot, '.dev-mesh', 'state', 'sync.json'),
        `${JSON.stringify(
          {
            schemaVersion: 1,
            projectRoot,
            enabled: true,
            updatedAt: '2026-06-09T01:00:00.000Z',
            projection: {
              checkedAt: '2026-06-09T01:00:00.000Z',
              state: 'ready',
              rebuilt: false,
              message: 'legacy ready',
              crdtPath: join(projectRoot, '.dev-mesh', 'crdt', 'project.automerge'),
              currentHeads: ['head1'],
              sourceHeads: ['head1'],
              documentCount: 1
            },
            remotes: [],
            message: 'legacy sync status'
          },
          null,
          2
        )}\n`,
        'utf8'
      );

      await expect(readDaemonSyncStatus(projectRoot)).resolves.toMatchObject({
        schemaVersion: 2,
        enabled: true,
        updatedAt: '2026-06-09T01:00:00.000Z',
        crdt: {
          initialized: true,
          materialized: true,
          currentHeads: ['head1'],
          projectionSourceHeads: ['head1'],
          projectionState: 'ready'
        },
        projection: {
          state: 'ready',
          materialized: true,
          currentHeadCount: 1,
          sourceHeadCount: 1,
          documentCount: 1
        },
        remotes: [],
        message: 'legacy sync status'
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

async function waitForProjectionState(
  projectRoot: string,
  state: Awaited<ReturnType<typeof readProjectProjectionStatus>>['state'],
  timeoutMs = 3000
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await readProjectProjectionStatus(projectRoot);

    if (status.state === state) {
      return;
    }

    await sleep(25);
  }

  throw new Error(`Timed out waiting for projection state ${state}.`);
}

async function waitForDaemonStatus(projectRoot: string, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if ((await readDaemonSyncStatus(projectRoot)) !== undefined) {
      return;
    }

    await sleep(25);
  }

  throw new Error('Timed out waiting for daemon sync status.');
}

async function waitForProjectionDocument(projectRoot: string, id: string, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await readProjectProjectionStatus(projectRoot);

    if (status.state === 'ready' && status.documentCount === 1) {
      const items = await loadProjectKnowledgeItemsFromCrdt(projectRoot);

      if (items.some((item) => item.id === id)) {
        return;
      }
    }

    await sleep(25);
  }

  throw new Error(`Timed out waiting for projection document ${id}.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers
    }
  });
}

function toTestCrdtSyncChange(change: Uint8Array): TestCrdtSyncChange {
  return {
    id: createTestCrdtChangeId(change),
    engine: 'automerge',
    encoding: 'base64',
    bytes: Buffer.from(change).toString('base64'),
    headsBefore: [],
    headsAfter: []
  };
}

function decodeTestCrdtChange(change: TestCrdtSyncChange): Uint8Array {
  return new Uint8Array(Buffer.from(change.bytes, 'base64'));
}

function createTestCrdtChangeId(change: Uint8Array): string {
  return `am_${createHash('sha256').update(change).digest('hex').slice(0, 32)}`;
}

function createJoinedServerRecord(label: string, groupKey: string): Record<string, string> {
  return {
    serverUrl: `http://${label}.mesh.test`,
    mcpUrl: `http://${label}.mesh.test/mcp`,
    groupKey,
    memberId: `member_${label}_${groupKey}`,
    clientId: `client_${label}_${groupKey}`,
    displayName: label,
    joinedAt: '2026-06-09T00:00:00.000Z',
    accessToken: `mesh_${label}_token`,
    syncSigningSecret: `sync_${label}_secret`
  };
}

interface TestCrdtSyncRequest {
  clientId: string;
  projectKey: string;
  document: {
    kind: 'project';
    groupKey: string;
    projectKey: string;
    schemaVersion: 2;
  };
  heads: string[];
  changes: TestCrdtSyncChange[];
  maxChanges: number;
}

interface TestCrdtSyncChange {
  id: string;
  engine: 'automerge';
  encoding: 'base64';
  bytes: string;
  headsBefore: string[];
  headsAfter: string[];
}

import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createDevMeshCore, type DevMeshCore } from '@mcp-dev-mesh/core';
import { JsonlKnowledgeRepository } from '@mcp-dev-mesh/local-store';
import { createHubState, DEFAULT_LOCAL_INVITE_TOKEN, type HubState, type HubStateOptions } from '../src/hub-state.js';
import {
  createHubServer,
  deserializeHubState,
  federateHubSyncEventsFromHttpPeer,
  serializeHubState,
  type KoaHubServer,
  type HubStatePersistenceStore,
  type MeshServerOptions
} from '../src/index.js';

describe('hub server HTTP integration', () => {
  it('serves health and well-known metadata with Koa', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore()
    });

    try {
      const health = await requestJson(`${url}/healthz`);
      const wellKnown = await requestJson(`${url}/.well-known/dev-mesh`);

      expect(health.status).toBe(200);
      expect(health.body).toMatchObject({
        status: 'ok',
        service: 'mcp-dev-mesh'
      });
      expect(wellKnown.status).toBe(200);
      expect(wellKnown.body).toMatchObject({
        baseUrl: url,
        mcpUrl: `${url}/mcp`,
        install: {
          npmPackage: 'devmesh'
        }
      });
    } finally {
      await app.close();
    }
  });

  it('accepts join and sync requests', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore(),
      hub: {
        groups: [
          {
            key: 'frontend-team',
            displayName: 'Frontend Team'
          }
        ],
        invites: [
          {
            token: 'inv_frontend',
            groupKey: 'frontend-team'
          }
        ]
      }
    });

    try {
      const groups = await requestJson(`${url}/api/v1/groups`);
      const join = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_frontend',
          groupKey: 'frontend-team',
          displayName: 'Xiaoyun',
          handle: 'xiaoyun'
        }
      });
      const push = await requestJson(`${url}/api/v1/sync/push`, {
        method: 'POST',
        headers: authHeaders(join.body.accessToken),
        body: {
          clientId: join.body.clientId,
          events: [
            {
              id: 'evt_1',
              kind: 'knowledge.created',
              payload: {}
            }
          ]
        }
      });
      const pull = await requestJson(`${url}/api/v1/sync/pull`, {
        headers: authHeaders(join.body.accessToken)
      });
      const nextPull = await requestJson(`${url}/api/v1/sync/pull?cursor=${encodeURIComponent(push.body.cursor)}`, {
        headers: authHeaders(join.body.accessToken)
      });

      expect(groups.body).toMatchObject({
        groups: [
          {
            key: 'frontend-team',
            displayName: 'Frontend Team',
            joinMode: 'invite'
          }
        ]
      });
      expect(join.status).toBe(200);
      expect(join.body).toMatchObject({
        memberId: 'member_frontend-team_xiaoyun',
        clientId: expect.stringMatching(/^client_frontend-team_xiaoyun_/),
        groupKey: 'frontend-team',
        accessToken: expect.stringMatching(/^mesh_/),
        syncSigningSecret: expect.stringMatching(/^sync_/),
        expiresAt: expect.any(String)
      });
      expect(push.body).toMatchObject({
        accepted: 1,
        rejected: [],
        cursor: 'cur_frontend-team_1'
      });
      expect(pull.body).toMatchObject({
        cursor: 'cur_frontend-team_1',
        events: [
          expect.objectContaining({
            id: 'evt_1',
            kind: 'knowledge.created',
            payload: {},
            createdAt: expect.any(String),
            log: {
              sequence: 1,
              hash: expect.stringMatching(/^[a-f0-9]{64}$/)
            }
          })
        ]
      });
      expect(nextPull.body).toMatchObject({
        cursor: 'cur_frontend-team_1',
        events: []
      });
    } finally {
      await app.close();
    }
  });

  it('stores group-scoped sync events with incremental cursors and idempotent retries', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore(),
      hub: {
        groups: [
          {
            key: 'frontend-team',
            displayName: 'Frontend Team'
          },
          {
            key: 'backend-team',
            displayName: 'Backend Team'
          }
        ],
        invites: [
          {
            token: 'inv_frontend',
            groupKey: 'frontend-team'
          },
          {
            token: 'inv_backend',
            groupKey: 'backend-team'
          }
        ]
      }
    });

    try {
      const frontendJoin = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_frontend',
          displayName: 'Xiaoyun',
          handle: 'xiaoyun'
        }
      });
      const backendJoin = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_backend',
          displayName: 'Ayuan',
          handle: 'ayuan'
        }
      });
      const firstPush = await requestJson(`${url}/api/v1/sync/push`, {
        method: 'POST',
        headers: authHeaders(frontendJoin.body.accessToken),
        body: {
          clientId: frontendJoin.body.clientId,
          events: [
            {
              id: 'evt_frontend_1',
              kind: 'knowledge.created',
              payload: {
                title: 'Frontend event one'
              },
              createdAt: '2026-06-06T00:00:00.000Z'
            },
            {
              id: 'evt_frontend_2',
              kind: 'knowledge.updated',
              payload: {
                title: 'Frontend event two'
              }
            },
            {
              id: 'evt_invalid_payload',
              kind: 'knowledge.created',
              payload: []
            }
          ]
        }
      });
      const frontendInitialPull = await requestJson(`${url}/api/v1/sync/pull`, {
        headers: authHeaders(frontendJoin.body.accessToken)
      });
      const backendPull = await requestJson(`${url}/api/v1/sync/pull`, {
        headers: authHeaders(backendJoin.body.accessToken)
      });
      const retryPush = await requestJson(`${url}/api/v1/sync/push`, {
        method: 'POST',
        headers: authHeaders(frontendJoin.body.accessToken),
        body: {
          clientId: frontendJoin.body.clientId,
          events: [
            {
              id: 'evt_frontend_2',
              kind: 'knowledge.updated',
              payload: {
                title: 'Frontend event two retry'
              }
            },
            {
              id: 'evt_frontend_3',
              kind: 'knowledge.deleted',
              payload: {
                knowledgeId: 'kn_frontend_3',
                tombstone: true,
                reason: 'Superseded by canonical context',
                deletedAt: '2026-06-06T01:00:00.000Z'
              }
            }
          ]
        }
      });
      const invalidTombstonePush = await requestJson(`${url}/api/v1/sync/push`, {
        method: 'POST',
        headers: authHeaders(frontendJoin.body.accessToken),
        body: {
          clientId: frontendJoin.body.clientId,
          events: [
            {
              id: 'evt_invalid_tombstone',
              kind: 'knowledge.deleted',
              payload: {
                tombstone: true
              }
            }
          ]
        }
      });
      const frontendIncrementalPull = await requestJson(
        `${url}/api/v1/sync/pull?cursor=${encodeURIComponent(firstPush.body.cursor)}`,
        {
          headers: authHeaders(frontendJoin.body.accessToken)
        }
      );
      const tombstoneAudit = await requestJson(`${url}/api/v1/admin/audit?action=sync.tombstone_accepted`);
      const rejectedClient = await requestJson(`${url}/api/v1/sync/push`, {
        method: 'POST',
        headers: authHeaders(frontendJoin.body.accessToken),
        body: {
          clientId: backendJoin.body.clientId,
          events: []
        }
      });
      const [firstFrontendEvent, secondFrontendEvent] = frontendInitialPull.body.events;

      expect(firstPush.body).toMatchObject({
        accepted: 2,
        rejected: [
          {
            id: 'evt_invalid_payload',
            reason: 'event.payload_invalid'
          }
        ],
        cursor: 'cur_frontend-team_2'
      });
      expect(frontendInitialPull.body.events).toEqual([
        expect.objectContaining({
          id: 'evt_frontend_1',
          kind: 'knowledge.created',
          payload: {
            title: 'Frontend event one'
          },
          createdAt: '2026-06-06T00:00:00.000Z'
        }),
        expect.objectContaining({
          id: 'evt_frontend_2',
          kind: 'knowledge.updated',
          payload: {
            title: 'Frontend event two'
          },
          createdAt: expect.any(String)
        })
      ]);
      expect(firstFrontendEvent.log).toMatchObject({
        sequence: 1,
        hash: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
      expect(firstFrontendEvent.log.previousHash).toBeUndefined();
      expect(secondFrontendEvent.log).toMatchObject({
        sequence: 2,
        previousHash: firstFrontendEvent.log.hash,
        hash: expect.stringMatching(/^[a-f0-9]{64}$/)
      });
      expect(secondFrontendEvent.log.hash).not.toBe(firstFrontendEvent.log.hash);
      expect(backendPull.body).toMatchObject({
        cursor: 'cur_backend-team_0',
        events: []
      });
      expect(retryPush.body).toMatchObject({
        accepted: 1,
        rejected: [],
        cursor: 'cur_frontend-team_3'
      });
      expect(invalidTombstonePush.body).toMatchObject({
        accepted: 0,
        rejected: [
          {
            id: 'evt_invalid_tombstone',
            reason: 'event.tombstone_knowledge_id_required'
          }
        ],
        cursor: 'cur_frontend-team_3'
      });
      expect(frontendIncrementalPull.body).toMatchObject({
        cursor: 'cur_frontend-team_3',
        events: [
          expect.objectContaining({
            id: 'evt_frontend_3',
            kind: 'knowledge.deleted',
            payload: {
              knowledgeId: 'kn_frontend_3',
              tombstone: true,
              reason: 'Superseded by canonical context',
              deletedAt: '2026-06-06T01:00:00.000Z'
            },
            log: {
              sequence: 3,
              previousHash: secondFrontendEvent.log.hash,
              hash: expect.stringMatching(/^[a-f0-9]{64}$/)
            }
          })
        ]
      });
      expect(tombstoneAudit.body.auditLogs).toEqual([
        expect.objectContaining({
          action: 'sync.tombstone_accepted',
          targetType: 'knowledge',
          targetId: 'kn_frontend_3',
          groupKey: 'frontend-team',
          payload: expect.objectContaining({
            eventId: 'evt_frontend_3',
            clientId: frontendJoin.body.clientId,
            reason: 'Superseded by canonical context',
            deletedAt: '2026-06-06T01:00:00.000Z'
          })
        })
      ]);
      expect(rejectedClient.status).toBe(403);
      expect(rejectedClient.body).toMatchObject({
        error: {
          code: 'sync.client_mismatch'
        }
      });
    } finally {
      await app.close();
    }
  });

  it('replays tombstone sync events into the knowledge repository', async () => {
    const core = createDevMeshCore();
    const item = await core.captureKnowledge({
      id: 'kn_tombstone_sync_1',
      type: 'decision',
      title: 'Tombstone replay target',
      summary: 'This knowledge should disappear from default sync search after replay.',
      tags: ['sync', 'tombstone']
    });
    const { app, url } = await startHubServer({
      core
    });

    try {
      const joined = await joinDefaultGroup(url);
      const push = await requestJson(`${url}/api/v1/sync/push`, {
        method: 'POST',
        headers: authHeaders(joined.accessToken),
        body: {
          clientId: joined.clientId,
          events: [
            {
              id: 'evt_tombstone_replay_1',
              kind: 'knowledge.deleted',
              payload: {
                knowledgeId: item.id,
                tombstone: true,
                reason: 'Remote deletion won conflict replay',
                deletedAt: '2026-06-07T03:00:00.000Z'
              },
              createdAt: '2026-06-07T03:00:00.000Z'
            }
          ]
        }
      });
      const stored = await core.getKnowledge(item.id);
      const defaultSearch = await core.searchKnowledge({
        query: 'tombstone replay target',
        limit: 10
      });
      const allKnowledge = await core.listKnowledge({
        includeSuperseded: true
      });
      const audit = await requestJson(`${url}/api/v1/admin/audit?action=sync.tombstone_replayed`);

      expect(push.body).toMatchObject({
        accepted: 1,
        rejected: [],
        cursor: 'cur_default_1'
      });
      expect(stored).toMatchObject({
        id: item.id,
        status: 'tombstone',
        updatedAt: '2026-06-07T03:00:00.000Z'
      });
      expect(defaultSearch.map((result) => result.id)).not.toContain(item.id);
      expect(allKnowledge).toEqual([
        expect.objectContaining({
          id: item.id,
          status: 'tombstone'
        })
      ]);
      expect(audit.body.auditLogs).toEqual([
        expect.objectContaining({
          action: 'sync.tombstone_replayed',
          targetType: 'knowledge',
          targetId: item.id,
          groupKey: joined.groupKey,
          payload: expect.objectContaining({
            eventId: 'evt_tombstone_replay_1',
            clientId: joined.clientId,
            previousStatus: 'active',
            reason: 'Remote deletion won conflict replay',
            deletedAt: '2026-06-07T03:00:00.000Z'
          })
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it('replays offline sync conflicts into admin knowledge edges', async () => {
    const core = createDevMeshCore();
    const base = await core.captureKnowledge({
      id: 'kn_http_conflict_base',
      type: 'decision',
      title: 'HTTP offline conflict base',
      summary: 'Two clients update this base decision while disconnected.'
    });
    const localRevision = await core.captureKnowledge({
      id: 'kn_http_conflict_revision_local',
      type: 'decision',
      title: 'HTTP offline conflict local revision',
      summary: 'The local branch keeps the existing sync flow.'
    });
    const remoteRevision = await core.captureKnowledge({
      id: 'kn_http_conflict_revision_remote',
      type: 'decision',
      title: 'HTTP offline conflict remote revision',
      summary: 'The remote branch changes the sync flow.'
    });
    const { app, url } = await startHubServer({
      core
    });

    try {
      const localJoin = await joinDefaultGroup(url);
      const remoteJoin = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: DEFAULT_LOCAL_INVITE_TOKEN,
          displayName: 'Ayuan',
          handle: 'ayuan'
        }
      });
      const localPush = await requestJson(`${url}/api/v1/sync/push`, {
        method: 'POST',
        headers: authHeaders(localJoin.accessToken),
        body: {
          clientId: localJoin.clientId,
          events: [
            {
              id: 'evt_http_conflict_local',
              kind: 'knowledge.updated',
              payload: {
                knowledgeId: base.id,
                revisionId: localRevision.id,
                conflict: true,
                reason: 'Offline edits diverged'
              },
              createdAt: '2026-06-07T06:00:00.000Z'
            }
          ]
        }
      });
      const remotePush = await requestJson(`${url}/api/v1/sync/push`, {
        method: 'POST',
        headers: authHeaders(remoteJoin.body.accessToken),
        body: {
          clientId: remoteJoin.body.clientId,
          events: [
            {
              id: 'evt_http_conflict_remote',
              kind: 'knowledge.updated',
              payload: {
                knowledgeId: base.id,
                revisionId: remoteRevision.id,
                conflict: true,
                reason: 'Offline edits diverged'
              },
              createdAt: '2026-06-07T06:01:00.000Z'
            }
          ]
        }
      });
      const retryPush = await requestJson(`${url}/api/v1/sync/push`, {
        method: 'POST',
        headers: authHeaders(remoteJoin.body.accessToken),
        body: {
          clientId: remoteJoin.body.clientId,
          events: [
            {
              id: 'evt_http_conflict_remote',
              kind: 'knowledge.updated',
              payload: {
                knowledgeId: base.id,
                revisionId: remoteRevision.id,
                conflict: true,
                reason: 'Offline edits diverged'
              }
            }
          ]
        }
      });
      const edges = await requestJson(`${url}/api/v1/admin/knowledge-edges?kind=contradicts&groupKey=default`);
      const audit = await requestJson(`${url}/api/v1/admin/audit?action=sync.conflict_replayed`);

      expect(localPush.body).toMatchObject({
        accepted: 1,
        rejected: [],
        cursor: 'cur_default_1'
      });
      expect(remotePush.body).toMatchObject({
        accepted: 1,
        rejected: [],
        cursor: 'cur_default_2'
      });
      expect(retryPush.body).toMatchObject({
        accepted: 0,
        rejected: [],
        cursor: 'cur_default_2'
      });
      expect(edges.body.edges).toEqual([
        expect.objectContaining({
          kind: 'contradicts',
          fromId: localRevision.id,
          toId: remoteRevision.id,
          createdBy: remoteJoin.body.memberId,
          groupKey: 'default',
          reason: 'Offline edits diverged'
        })
      ]);
      expect(audit.body.auditLogs).toEqual([
        expect.objectContaining({
          action: 'sync.conflict_replayed',
          targetType: 'knowledge-edge',
          targetId: edges.body.edges[0].id,
          groupKey: 'default',
          payload: expect.objectContaining({
            knowledgeId: base.id,
            eventIds: ['evt_http_conflict_local', 'evt_http_conflict_remote'],
            clientIds: [localJoin.clientId, remoteJoin.body.clientId]
          })
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it('federates sync events from an HTTP peer event log', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore()
    });
    const target = createHubState();

    try {
      const joined = await joinDefaultGroup(url);
      const push = await requestJson(`${url}/api/v1/sync/push`, {
        method: 'POST',
        headers: authHeaders(joined.accessToken),
        body: {
          clientId: joined.clientId,
          events: [
            {
              id: 'evt_http_federation_1',
              kind: 'knowledge.created',
              payload: {
                title: 'HTTP federation event one'
              },
              createdAt: '2026-06-07T04:00:00.000Z'
            },
            {
              id: 'evt_http_federation_2',
              kind: 'knowledge.updated',
              payload: {
                title: 'HTTP federation event two'
              },
              createdAt: '2026-06-07T04:01:00.000Z'
            }
          ]
        }
      });
      const forbidden = await requestJson(`${url}/api/v1/federation/sync-events?groupKey=other-team`, {
        headers: authHeaders(joined.accessToken)
      });
      const firstSync = await federateHubSyncEventsFromHttpPeer(target, {
        peerId: 'peer_http_source',
        peerBaseUrl: url,
        accessToken: joined.accessToken,
        groupKey: joined.groupKey,
        limit: 1
      });
      const secondSync = await federateHubSyncEventsFromHttpPeer(target, {
        peerId: 'peer_http_source',
        peerBaseUrl: url,
        accessToken: joined.accessToken,
        groupKey: joined.groupKey
      });
      const emptySync = await federateHubSyncEventsFromHttpPeer(target, {
        peerId: 'peer_http_source',
        peerBaseUrl: url,
        accessToken: joined.accessToken,
        groupKey: joined.groupKey
      });
      const targetEvents = target.syncEvents.get(joined.groupKey) ?? [];

      expect(push.body).toMatchObject({
        accepted: 2,
        rejected: [],
        cursor: 'cur_default_2'
      });
      expect(forbidden.status).toBe(403);
      expect(forbidden.body).toMatchObject({
        error: {
          code: 'federation.group_mismatch'
        }
      });
      expect(firstSync).toMatchObject({
        ok: true,
        value: {
          peerId: 'peer_http_source',
          groupKey: joined.groupKey,
          cursor: 'cur_default_1',
          pulled: 1,
          accepted: 1,
          skipped: 0
        }
      });
      expect(secondSync).toMatchObject({
        ok: true,
        value: {
          previousCursor: 'cur_default_1',
          cursor: 'cur_default_2',
          pulled: 1,
          accepted: 1,
          skipped: 0
        }
      });
      expect(emptySync).toMatchObject({
        ok: true,
        value: {
          previousCursor: 'cur_default_2',
          cursor: 'cur_default_2',
          pulled: 0,
          accepted: 0,
          skipped: 0
        }
      });
      expect(targetEvents).toEqual([
        expect.objectContaining({
          id: 'evt_http_federation_1',
          clientId: joined.clientId,
          groupKey: joined.groupKey,
          log: expect.objectContaining({
            sequence: 1,
            hash: expect.stringMatching(/^[a-f0-9]{64}$/)
          })
        }),
        expect.objectContaining({
          id: 'evt_http_federation_2',
          clientId: joined.clientId,
          groupKey: joined.groupKey,
          log: expect.objectContaining({
            sequence: 2,
            previousHash: targetEvents[0]?.log?.hash,
            hash: expect.stringMatching(/^[a-f0-9]{64}$/)
          })
        })
      ]);
      expect(target.auditLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'federation.synced',
            actor: 'peer_http_source',
            groupKey: joined.groupKey,
            payload: expect.objectContaining({
              pulled: 1,
              accepted: 1
            })
          }),
          expect.objectContaining({
            action: 'federation.synced',
            actor: 'peer_http_source',
            groupKey: joined.groupKey,
            payload: expect.objectContaining({
              previousCursor: 'cur_default_1',
              pulled: 1,
              accepted: 1
            })
          })
        ])
      );
    } finally {
      await app.close();
    }
  });

  it('verifies signed sync events and audits tampered payloads', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore()
    });

    try {
      const joined = await joinDefaultGroup(url);
      const signedEvent = signSyncEvent({
        clientId: joined.clientId,
        groupKey: joined.groupKey,
        secret: joined.syncSigningSecret,
        signedAt: '2026-06-06T12:00:00.000Z',
        event: {
          id: 'evt_signed_1',
          kind: 'knowledge.created',
          payload: {
            title: 'Signed sync event'
          },
          createdAt: '2026-06-06T11:59:00.000Z'
        }
      });
      const accepted = await requestJson(`${url}/api/v1/sync/push`, {
        method: 'POST',
        headers: authHeaders(joined.accessToken),
        body: {
          clientId: joined.clientId,
          events: [signedEvent]
        }
      });
      const tamperedEvent = {
        ...signSyncEvent({
          clientId: joined.clientId,
          groupKey: joined.groupKey,
          secret: joined.syncSigningSecret,
          signedAt: '2026-06-06T12:05:00.000Z',
          event: {
            id: 'evt_tampered_1',
            kind: 'knowledge.created',
            payload: {
              title: 'Original signed payload'
            },
            createdAt: '2026-06-06T12:04:00.000Z'
          }
        }),
        payload: {
          title: 'Tampered signed payload'
        }
      };
      const rejected = await requestJson(`${url}/api/v1/sync/push`, {
        method: 'POST',
        headers: authHeaders(joined.accessToken),
        body: {
          clientId: joined.clientId,
          events: [tamperedEvent]
        }
      });
      const pulled = await requestJson(`${url}/api/v1/sync/pull`, {
        headers: authHeaders(joined.accessToken)
      });
      const audit = await requestJson(`${url}/api/v1/admin/audit?action=sync.event_signature_rejected`);

      expect(accepted.body).toMatchObject({
        accepted: 1,
        rejected: [],
        cursor: 'cur_default_1'
      });
      expect(rejected.body).toMatchObject({
        accepted: 0,
        rejected: [
          {
            id: 'evt_tampered_1',
            reason: 'event.signature_mismatch'
          }
        ],
        cursor: 'cur_default_1'
      });
      expect(pulled.body.events).toEqual([
        expect.objectContaining({
          id: 'evt_signed_1',
          signature: expect.objectContaining({
            algorithm: 'hmac-sha256',
            value: signedEvent.signature.value,
            signedAt: '2026-06-06T12:00:00.000Z'
          }),
          log: {
            sequence: 1,
            hash: expect.stringMatching(/^[a-f0-9]{64}$/)
          }
        })
      ]);
      expect(audit.body.auditLogs).toEqual([
        expect.objectContaining({
          action: 'sync.event_signature_rejected',
          targetId: 'evt_tampered_1',
          groupKey: 'default',
          payload: expect.objectContaining({
            clientId: joined.clientId,
            reason: 'event.signature_mismatch'
          })
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it('validates invite tokens and scopes projects to the joined group', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore(),
      hub: {
        groups: [
          {
            key: 'frontend-team',
            displayName: 'Frontend Team'
          },
          {
            key: 'backend-team',
            displayName: 'Backend Team'
          }
        ],
        invites: [
          {
            token: 'inv_frontend',
            groupKey: 'frontend-team'
          },
          {
            token: 'inv_backend',
            groupKey: 'backend-team'
          }
        ]
      }
    });

    try {
      const missingInvite = await requestJson(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          displayName: 'No Token'
        }
      });
      const mismatchedGroup = await requestJson(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_frontend',
          groupKey: 'backend-team',
          displayName: 'Wrong Group'
        }
      });
      const frontendJoin = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_frontend',
          displayName: 'Xiaoyun',
          handle: 'xiaoyun'
        }
      });
      const backendJoin = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_backend',
          displayName: 'Ayuan',
          handle: 'ayuan'
        }
      });
      const frontendProject = await requestJson(`${url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(frontendJoin.body.accessToken),
        body: {
          id: 'shared-dashboard',
          name: 'Shared Dashboard Frontend'
        }
      });
      const backendProject = await requestJson(`${url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(backendJoin.body.accessToken),
        body: {
          id: 'shared-dashboard',
          name: 'Shared Dashboard Backend'
        }
      });

      await requestJson(`${url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(backendJoin.body.accessToken),
        body: {
          id: 'backend-private',
          name: 'Backend Private'
        }
      });

      const frontendProjects = await requestJson(`${url}/api/v1/projects`, {
        headers: authHeaders(frontendJoin.body.accessToken)
      });
      const backendProjects = await requestJson(`${url}/api/v1/projects`, {
        headers: authHeaders(backendJoin.body.accessToken)
      });
      const backendOnlyBrief = await requestJson(`${url}/api/v1/projects/backend-private/brief`, {
        headers: authHeaders(frontendJoin.body.accessToken)
      });

      expect(missingInvite.status).toBe(401);
      expect(missingInvite.body).toMatchObject({
        error: {
          code: 'join.invite_required'
        }
      });
      expect(mismatchedGroup.status).toBe(403);
      expect(mismatchedGroup.body).toMatchObject({
        error: {
          code: 'join.group_mismatch'
        }
      });
      expect(frontendProject.body.project).toMatchObject({
        id: 'shared-dashboard',
        groupKey: 'frontend-team',
        name: 'Shared Dashboard Frontend'
      });
      expect(backendProject.body.project).toMatchObject({
        id: 'shared-dashboard',
        groupKey: 'backend-team',
        name: 'Shared Dashboard Backend'
      });
      expect(frontendProjects.body.projects).toEqual([
        expect.objectContaining({
          id: 'shared-dashboard',
          groupKey: 'frontend-team',
          name: 'Shared Dashboard Frontend'
        })
      ]);
      expect(backendProjects.body.projects).toEqual([
        expect.objectContaining({
          id: 'backend-private',
          groupKey: 'backend-team',
          name: 'Backend Private'
        }),
        expect.objectContaining({
          id: 'shared-dashboard',
          groupKey: 'backend-team',
          name: 'Shared Dashboard Backend'
        })
      ]);
      expect(backendOnlyBrief.status).toBe(404);
      expect(backendOnlyBrief.body).toMatchObject({
        error: {
          code: 'project.not_found'
        }
      });
    } finally {
      await app.close();
    }
  });

  it('rotates bearer access tokens and revokes the previous token', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore()
    });

    try {
      const joined = await joinDefaultGroup(url);
      const rotated = await requestJson<JoinResponseBody>(`${url}/api/v1/auth/rotate`, {
        method: 'POST',
        headers: authHeaders(joined.accessToken)
      });
      const oldTokenProjects = await requestJson(`${url}/api/v1/projects`, {
        headers: authHeaders(joined.accessToken)
      });
      const newTokenProject = await requestJson(`${url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(rotated.body.accessToken),
        body: {
          id: 'rotated-token-project',
          name: 'Rotated Token Project'
        }
      });
      const audit = await requestJson(`${url}/api/v1/admin/audit?action=auth.token_rotated`);
      const auditPayload = audit.body.auditLogs[0]?.payload;

      expect(rotated.status).toBe(200);
      expect(rotated.body).toMatchObject({
        memberId: joined.memberId,
        clientId: joined.clientId,
        groupKey: joined.groupKey,
        syncSigningSecret: joined.syncSigningSecret,
        expiresAt: expect.any(String)
      });
      expect(rotated.body.accessToken).toMatch(/^mesh_/);
      expect(rotated.body.accessToken).not.toBe(joined.accessToken);
      expect(Date.parse(rotated.body.expiresAt)).toBeGreaterThanOrEqual(Date.parse(joined.expiresAt));
      expect(oldTokenProjects.status).toBe(401);
      expect(oldTokenProjects.body).toMatchObject({
        error: {
          code: 'auth.invalid_token'
        }
      });
      expect(newTokenProject.status).toBe(200);
      expect(newTokenProject.body.project).toMatchObject({
        id: 'rotated-token-project',
        createdByMemberId: joined.memberId
      });
      expect(audit.body.auditLogs).toEqual([
        expect.objectContaining({
          actor: joined.memberId,
          action: 'auth.token_rotated',
          targetType: 'member',
          targetId: joined.memberId,
          groupKey: joined.groupKey,
          payload: expect.objectContaining({
            clientId: joined.clientId,
            previousExpiresAt: joined.expiresAt,
            expiresAt: rotated.body.expiresAt
          })
        })
      ]);
      expect(JSON.stringify(auditPayload)).not.toContain(joined.accessToken);
      expect(JSON.stringify(auditPayload)).not.toContain(rotated.body.accessToken);
    } finally {
      await app.close();
    }
  });

  it('rotates member access tokens through the admin API', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore()
    });

    try {
      const joined = await joinDefaultGroup(url);
      const rotated = await requestJson<JoinResponseBody>(`${url}/api/v1/admin/members/${joined.memberId}/rotate-token`, {
        method: 'POST'
      });
      const oldTokenProjects = await requestJson(`${url}/api/v1/projects`, {
        headers: authHeaders(joined.accessToken)
      });
      const newTokenProject = await requestJson(`${url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(rotated.body.accessToken),
        body: {
          id: 'admin-rotated-token-project',
          name: 'Admin Rotated Token Project'
        }
      });
      const members = await requestJson(`${url}/api/v1/admin/members`);
      const audit = await requestJson(`${url}/api/v1/admin/audit?action=auth.token_rotated`);
      const auditPayload = audit.body.auditLogs[0]?.payload;

      expect(rotated.status).toBe(200);
      expect(rotated.body).toMatchObject({
        memberId: joined.memberId,
        clientId: joined.clientId,
        groupKey: joined.groupKey,
        syncSigningSecret: joined.syncSigningSecret,
        expiresAt: expect.any(String)
      });
      expect(rotated.body.accessToken).toMatch(/^mesh_/);
      expect(rotated.body.accessToken).not.toBe(joined.accessToken);
      expect(oldTokenProjects.status).toBe(401);
      expect(newTokenProject.status).toBe(200);
      expect(members.body.members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            memberId: joined.memberId,
            tokenExpiresAt: rotated.body.expiresAt
          })
        ])
      );
      expect(audit.body.auditLogs).toEqual([
        expect.objectContaining({
          actor: 'admin',
          action: 'auth.token_rotated',
          targetType: 'member',
          targetId: joined.memberId,
          groupKey: joined.groupKey,
          payload: expect.objectContaining({
            clientId: joined.clientId,
            previousExpiresAt: joined.expiresAt,
            expiresAt: rotated.body.expiresAt,
            revokedTokenCount: 1
          })
        })
      ]);
      expect(JSON.stringify(auditPayload)).not.toContain(joined.accessToken);
      expect(JSON.stringify(auditPayload)).not.toContain(rotated.body.accessToken);
      expect(JSON.stringify(auditPayload)).not.toContain(rotated.body.syncSigningSecret);
    } finally {
      await app.close();
    }
  });

  it('serves admin data for the Vue management dashboard', async () => {
    const core = createDevMeshCore();
    await core.captureKnowledge({
      type: 'decision',
      layer: 'canonical',
      title: 'Admin dashboard lists knowledge',
      summary: 'The management page should show server knowledge and quality signals.'
    });
    const { app, url } = await startHubServer({ core });

    try {
      const group = await requestJson(`${url}/api/v1/admin/groups`, {
        method: 'POST',
        body: {
          key: 'design-team',
          displayName: 'Design Team',
          description: 'Owns UI system decisions.'
        }
      });
      const project = await requestJson(`${url}/api/v1/admin/projects`, {
        method: 'POST',
        body: {
          groupKey: 'design-team',
          id: 'component-library',
          name: 'Component Library'
        }
      });
      const overview = await requestJson(`${url}/api/v1/admin/overview`);
      const groups = await requestJson(`${url}/api/v1/admin/groups`);
      const projects = await requestJson(`${url}/api/v1/admin/projects`);
      const knowledge = await requestJson(`${url}/api/v1/admin/knowledge?layer=canonical`);
      const reviewQueue = await requestJson(`${url}/api/v1/admin/review-queue`);

      expect(group.body).toMatchObject({
        key: 'design-team',
        displayName: 'Design Team'
      });
      expect(project.body).toMatchObject({
        id: 'component-library',
        groupKey: 'design-team',
        name: 'Component Library'
      });
      expect(overview.body).toMatchObject({
        counts: {
          groups: 2,
          projects: 1,
          knowledgeItems: 1
        },
        mcpUrl: `${url}/mcp`
      });
      expect(groups.body.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'design-team',
            projectCount: 1
          })
        ])
      );
      expect(projects.body.projects).toEqual([
        expect.objectContaining({
          id: 'component-library',
          groupKey: 'design-team'
        })
      ]);
      expect(knowledge.body.items).toEqual([
        expect.objectContaining({
          title: 'Admin dashboard lists knowledge',
          layer: 'canonical'
        })
      ]);
      expect(reviewQueue.body).toEqual({
        items: []
      });
    } finally {
      await app.close();
    }
  });

  it('manages invites, disabled members, and audit logs through admin APIs', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore()
    });

    try {
      const invite = await requestJson(`${url}/api/v1/admin/invites`, {
        method: 'POST',
        body: {
          groupKey: 'default',
          token: 'inv_admin_panel',
          maxUses: 2
        }
      });
      const invites = await requestJson(`${url}/api/v1/admin/invites`);
      const joined = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_admin_panel',
          displayName: 'Xiaoyun',
          handle: 'xiaoyun'
        }
      });
      const disabled = await requestJson(`${url}/api/v1/admin/members/${joined.body.memberId}/disable`, {
        method: 'POST',
        body: {
          reason: 'Rotated off the project'
        }
      });
      const rejectedProjects = await requestJson(`${url}/api/v1/projects`, {
        headers: authHeaders(joined.body.accessToken)
      });
      const revoked = await requestJson(`${url}/api/v1/admin/invites/inv_admin_panel`, {
        method: 'DELETE'
      });
      const revokedJoin = await requestJson(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_admin_panel',
          displayName: 'Ayuan',
          handle: 'ayuan'
        }
      });
      const audit = await requestJson(`${url}/api/v1/admin/audit?limit=10`);
      const memberAudit = await requestJson(`${url}/api/v1/admin/audit?action=member.disabled`);

      expect(invite.body).toMatchObject({
        token: 'inv_admin_panel',
        groupKey: 'default',
        uses: 0,
        maxUses: 2,
        expiresAt: expect.any(String),
        status: 'active'
      });
      expect(Date.parse(invite.body.expiresAt)).toBeGreaterThan(Date.parse(invite.body.createdAt));
      expect(invites.body.invites).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            token: 'inv_admin_panel',
            status: 'active'
          })
        ])
      );
      expect(disabled.body).toMatchObject({
        memberId: joined.body.memberId,
        status: 'disabled',
        disabledReason: 'Rotated off the project'
      });
      expect(rejectedProjects.status).toBe(403);
      expect(rejectedProjects.body).toMatchObject({
        error: {
          code: 'auth.member_disabled'
        }
      });
      expect(revoked.body).toMatchObject({
        token: 'inv_admin_panel',
        status: 'revoked',
        revokedBy: 'admin'
      });
      expect(revokedJoin.status).toBe(401);
      expect(revokedJoin.body).toMatchObject({
        error: {
          code: 'join.invite_invalid'
        }
      });
      expect(audit.body.auditLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'invite.created',
            targetId: 'inv_admin_panel',
            payload: expect.objectContaining({
              expiresAt: invite.body.expiresAt,
              maxUses: 2
            })
          }),
          expect.objectContaining({
            action: 'member.joined',
            targetId: joined.body.memberId
          }),
          expect.objectContaining({
            action: 'member.disabled',
            targetId: joined.body.memberId
          }),
          expect.objectContaining({
            action: 'invite.revoked',
            targetId: 'inv_admin_panel'
          })
        ])
      );
      expect(memberAudit.body.auditLogs).toEqual([
        expect.objectContaining({
          action: 'member.disabled',
          targetId: joined.body.memberId
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it('enforces admin-managed project ACLs for project lists and briefs', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore()
    });

    try {
      const owner = await joinDefaultGroup(url);
      const maintainerJoin = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: DEFAULT_LOCAL_INVITE_TOKEN,
          displayName: 'Ayuan',
          handle: 'ayuan'
        }
      });
      const created = await requestJson(`${url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(owner.accessToken),
        body: {
          id: 'restricted-dashboard',
          name: 'Restricted Dashboard'
        }
      });
      const acl = await requestJson(`${url}/api/v1/admin/projects/default/restricted-dashboard/acl`, {
        method: 'PUT',
        body: {
          visibility: 'restricted',
          members: [
            {
              memberId: maintainerJoin.body.memberId,
              role: 'maintainer'
            }
          ]
        }
      });
      const ownerProjects = await requestJson(`${url}/api/v1/projects`, {
        headers: authHeaders(owner.accessToken)
      });
      const ownerBrief = await requestJson(`${url}/api/v1/projects/restricted-dashboard/brief`, {
        headers: authHeaders(owner.accessToken)
      });
      const maintainerProjects = await requestJson(`${url}/api/v1/projects`, {
        headers: authHeaders(maintainerJoin.body.accessToken)
      });
      const adminProjects = await requestJson(`${url}/api/v1/admin/projects`);
      const aclAudit = await requestJson(`${url}/api/v1/admin/audit?action=project.acl.updated`);

      expect(created.body.project).toMatchObject({
        id: 'restricted-dashboard',
        access: {
          visibility: 'group',
          members: []
        }
      });
      expect(acl.body).toMatchObject({
        id: 'restricted-dashboard',
        access: {
          visibility: 'restricted',
          members: [
            {
              memberId: maintainerJoin.body.memberId,
              role: 'maintainer'
            }
          ]
        }
      });
      expect(ownerProjects.body.projects).toEqual([]);
      expect(ownerBrief.status).toBe(404);
      expect(ownerBrief.body).toMatchObject({
        error: {
          code: 'project.not_found'
        }
      });
      expect(maintainerProjects.body.projects).toEqual([
        expect.objectContaining({
          id: 'restricted-dashboard',
          access: {
            visibility: 'restricted',
            members: [
              {
                memberId: maintainerJoin.body.memberId,
                role: 'maintainer'
              }
            ]
          }
        })
      ]);
      expect(adminProjects.body.projects).toEqual([
        expect.objectContaining({
          id: 'restricted-dashboard',
          access: {
            visibility: 'restricted',
            members: [
              {
                memberId: maintainerJoin.body.memberId,
                role: 'maintainer'
              }
            ]
          }
        })
      ]);
      expect(aclAudit.body.auditLogs).toEqual([
        expect.objectContaining({
          action: 'project.acl.updated',
          targetId: 'restricted-dashboard'
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it('includes org-visible knowledge in project briefs across groups', async () => {
    const core = createDevMeshCore();
    await core.captureKnowledge({
      id: 'kn_frontend_project_brief_local',
      type: 'decision',
      layer: 'canonical',
      title: 'frontend-dashboard local routing convention',
      summary: 'The frontend-dashboard local group owns the routing convention.',
      visibility: 'project',
      para: {
        category: 'projects',
        key: 'frontend-dashboard'
      },
      source: {
        kind: 'admin',
        metadata: {
          groupKey: 'frontend-team',
          projectKey: 'frontend-dashboard'
        }
      }
    });
    await core.captureKnowledge({
      id: 'kn_frontend_project_brief_backend_team',
      type: 'decision',
      layer: 'canonical',
      title: 'frontend-dashboard backend team rollout note',
      summary: 'The backend-team note should not cross the group boundary.',
      visibility: 'team',
      para: {
        category: 'projects',
        key: 'frontend-dashboard'
      },
      source: {
        kind: 'admin',
        metadata: {
          groupKey: 'backend-team',
          projectKey: 'frontend-dashboard'
        }
      }
    });
    await core.captureKnowledge({
      id: 'kn_frontend_project_brief_org',
      type: 'convention',
      layer: 'canonical',
      title: 'frontend-dashboard org-wide API naming convention',
      summary: 'The org-wide API naming convention is shared with every group.',
      visibility: 'org',
      para: {
        category: 'projects',
        key: 'frontend-dashboard'
      },
      source: {
        kind: 'admin',
        metadata: {
          groupKey: 'backend-team',
          projectKey: 'frontend-dashboard'
        }
      }
    });
    const { app, url } = await startHubServer({
      core,
      hub: {
        groups: [
          {
            key: 'frontend-team',
            displayName: 'Frontend Team'
          },
          {
            key: 'backend-team',
            displayName: 'Backend Team'
          }
        ],
        invites: [
          {
            token: 'inv_frontend_org_brief',
            groupKey: 'frontend-team'
          },
          {
            token: 'inv_backend_org_brief',
            groupKey: 'backend-team'
          }
        ]
      }
    });

    try {
      const frontendJoin = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
        method: 'POST',
        body: {
          inviteToken: 'inv_frontend_org_brief',
          displayName: 'Xiaoyun',
          handle: 'xiaoyun'
        }
      });
      const project = await requestJson(`${url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(frontendJoin.body.accessToken),
        body: {
          id: 'frontend-dashboard',
          name: 'Frontend Dashboard'
        }
      });
      const brief = await requestJson(`${url}/api/v1/projects/frontend-dashboard/brief`, {
        headers: authHeaders(frontendJoin.body.accessToken)
      });
      const briefItemIds = brief.body.items.map((item: { id: string }) => item.id);

      expect(project.body.project).toMatchObject({
        id: 'frontend-dashboard',
        groupKey: 'frontend-team'
      });
      expect(brief.status).toBe(200);
      expect(brief.body).toMatchObject({
        projectId: 'frontend-dashboard',
        groupKey: 'frontend-team'
      });
      expect(briefItemIds).toEqual(
        expect.arrayContaining(['kn_frontend_project_brief_local', 'kn_frontend_project_brief_org'])
      );
      expect(briefItemIds).not.toContain('kn_frontend_project_brief_backend_team');
    } finally {
      await app.close();
    }
  });

  it('manages project glossary items through admin APIs', async () => {
    const { app, url } = await startHubServer({
      core: createDevMeshCore()
    });

    try {
      const created = await requestJson(`${url}/api/v1/admin/glossary`, {
        method: 'POST',
        body: {
          groupKey: 'default',
          projectKey: 'frontend-dashboard',
          term: 'Mesh Client',
          definition: 'The local proxy and capture runtime that runs on a developer machine.',
          aliases: ['local proxy'],
          tags: ['client']
        }
      });
      const listed = await requestJson(`${url}/api/v1/admin/glossary?projectKey=frontend-dashboard`);
      const updated = await requestJson(`${url}/api/v1/admin/glossary/${created.body.id}`, {
        method: 'PUT',
        body: {
          groupKey: 'default',
          projectKey: 'frontend-dashboard',
          term: 'Mesh Client',
          definition: 'The local MCP proxy, capture runtime, and sync client on a developer machine.',
          aliases: ['local proxy', 'sync client']
        }
      });
      const searched = await requestJson(`${url}/api/v1/admin/glossary?query=sync%20client`);
      const audit = await requestJson(`${url}/api/v1/admin/audit?action=glossary.updated`);

      expect(created.status).toBe(200);
      expect(created.body).toMatchObject({
        type: 'glossary',
        layer: 'canonical',
        title: 'Mesh Client',
        summary: 'The local proxy and capture runtime that runs on a developer machine.',
        para: {
          category: 'resources',
          key: 'glossary/frontend-dashboard'
        },
        tags: expect.arrayContaining(['glossary', 'client']),
        source: {
          kind: 'admin',
          metadata: {
            groupKey: 'default',
            projectKey: 'frontend-dashboard',
            aliases: ['local proxy']
          }
        }
      });
      expect(listed.body.items).toEqual([
        expect.objectContaining({
          id: created.body.id,
          title: 'Mesh Client'
        })
      ]);
      expect(updated.body).toMatchObject({
        id: created.body.id,
        summary: 'The local MCP proxy, capture runtime, and sync client on a developer machine.',
        source: {
          metadata: {
            aliases: ['local proxy', 'sync client']
          }
        }
      });
      expect(searched.body.items).toEqual([
        expect.objectContaining({
          id: created.body.id,
          summary: expect.stringContaining('sync client')
        })
      ]);
      expect(audit.body.auditLogs).toEqual([
        expect.objectContaining({
          action: 'glossary.updated',
          targetId: created.body.id,
          groupKey: 'default'
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it('surfaces knowledge quality review candidates through admin APIs', async () => {
    const core = createDevMeshCore();
    const staleItem = await core.captureKnowledge({
      type: 'decision',
      layer: 'canonical',
      title: 'quality-review stale canonical decision',
      summary: 'Old low-confidence canonical knowledge should be revisited.',
      confidence: 0.25,
      createdAt: '2024-01-01T00:00:00.000Z'
    });
    const healthyItem = await core.captureKnowledge({
      type: 'decision',
      layer: 'canonical',
      title: 'quality-review healthy canonical decision',
      summary: 'High-confidence adopted canonical knowledge should not be flagged.',
      confidence: 0.95
    });
    await core.rateKnowledge({
      id: healthyItem.id,
      rating: 0.95,
      adoptionDelta: 0.8
    });
    const supersededItem = await core.captureKnowledge({
      type: 'decision',
      layer: 'canonical',
      title: 'quality-review superseded canonical decision',
      summary: 'Superseded canonical knowledge should remain visible to maintainers.',
      confidence: 0.9
    });
    await core.repository.upsert({
      ...supersededItem,
      status: 'superseded'
    });
    const extractItem = await core.captureKnowledge({
      type: 'note',
      layer: 'extract',
      title: 'quality-review low rating extract',
      summary: 'Low-rated extracted knowledge should show up when extract is selected.',
      confidence: 0.7
    });
    await core.rateKnowledge({
      id: extractItem.id,
      rating: 0.1
    });
    const { app, url } = await startHubServer({ core });

    try {
      const canonical = await requestJson(
        `${url}/api/v1/admin/quality-review?layer=canonical&maxQualityScore=0.6&staleDays=30&limit=10`
      );
      const activeOnly = await requestJson(
        `${url}/api/v1/admin/quality-review?layer=canonical&includeSuperseded=false&maxQualityScore=0.6&staleDays=30`
      );
      const extract = await requestJson(
        `${url}/api/v1/admin/quality-review?layer=extract&maxRating=0.2&maxQualityScore=0.4`
      );

      expect(canonical.body.summary).toMatchObject({
        totalKnowledge: 3,
        needsReview: 2,
        lowQuality: 2,
        lowConfidence: 1,
        stale: 1,
        nonActive: 1
      });
      expect(canonical.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            item: expect.objectContaining({
              id: staleItem.id,
              title: 'quality-review stale canonical decision'
            }),
            reasons: expect.arrayContaining(['low quality', 'low confidence', 'low adoption', 'stale'])
          }),
          expect.objectContaining({
            item: expect.objectContaining({
              id: supersededItem.id,
              status: 'superseded'
            }),
            reasons: expect.arrayContaining(['superseded'])
          })
        ])
      );
      expect(canonical.body.items).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({
            item: expect.objectContaining({
              id: healthyItem.id
            })
          })
        ])
      );
      expect(activeOnly.body.summary).toMatchObject({
        totalKnowledge: 2,
        nonActive: 0
      });
      expect(activeOnly.body.items).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({
            item: expect.objectContaining({
              id: supersededItem.id
            })
          })
        ])
      );
      expect(extract.body.items).toEqual([
        expect.objectContaining({
          item: expect.objectContaining({
            id: extractItem.id,
            layer: 'extract'
          }),
          reasons: expect.arrayContaining(['low rating'])
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it('summarizes task progress through admin task digest APIs', async () => {
    const core = createDevMeshCore();
    await core.captureKnowledge({
      type: 'task',
      layer: 'extract',
      title: 'Implement task digest',
      summary: '[todo] Sketch the task digest API.',
      tags: ['task', 'digest'],
      para: {
        category: 'projects',
        key: 'TASK-123'
      },
      createdBy: {
        displayName: 'Xiaoyun'
      },
      createdAt: '2026-06-05T08:00:00.000Z'
    });
    const blocked = await core.captureKnowledge({
      type: 'task',
      layer: 'extract',
      title: 'Implement task digest',
      summary: '[blocked] Waiting for admin API review.',
      tags: ['task', 'admin'],
      para: {
        category: 'projects',
        key: 'TASK-123'
      },
      createdBy: {
        displayName: 'Ayuan'
      },
      createdAt: '2026-06-06T08:00:00.000Z'
    });
    await core.captureKnowledge({
      type: 'task',
      layer: 'extract',
      title: 'Ship glossary admin',
      summary: '[done] Glossary admin is already shipped.',
      tags: ['task', 'glossary'],
      para: {
        category: 'projects',
        key: 'TASK-456'
      },
      createdBy: {
        displayName: 'Xiaoyun'
      },
      createdAt: '2026-06-04T08:00:00.000Z'
    });
    await core.captureKnowledge({
      type: 'task',
      layer: 'extract',
      title: 'Review active queue',
      summary: '[in_progress] Review queue state is being checked.',
      tags: ['task', 'review'],
      source: {
        kind: 'task',
        metadata: {
          taskKey: 'TASK-789',
          status: 'in_progress'
        }
      },
      createdBy: {
        displayName: 'Ming'
      },
      createdAt: '2026-06-06T07:00:00.000Z'
    });
    const { app, url } = await startHubServer({ core });

    try {
      const digest = await requestJson(`${url}/api/v1/admin/task-digest`);
      const blockedOnly = await requestJson(`${url}/api/v1/admin/task-digest?status=blocked`);
      const doneIncluded = await requestJson(`${url}/api/v1/admin/task-digest?includeDone=true`);
      const taskKey = await requestJson(`${url}/api/v1/admin/task-digest?projectKey=TASK-123`);

      expect(digest.body.summary).toMatchObject({
        totalTasks: 2,
        blocked: 1,
        inProgress: 1,
        done: 0
      });
      expect(digest.body.entries[0]).toMatchObject({
        taskKey: 'TASK-123',
        title: 'Implement task digest',
        status: 'blocked',
        latestSummary: 'Waiting for admin API review.',
        owners: ['Ayuan', 'Xiaoyun'],
        tags: ['admin', 'digest', 'task'],
        itemCount: 2,
        items: [
          expect.objectContaining({
            id: blocked.id
          }),
          expect.objectContaining({
            summary: '[todo] Sketch the task digest API.'
          })
        ]
      });
      expect(blockedOnly.body.entries).toEqual([
        expect.objectContaining({
          taskKey: 'TASK-123',
          status: 'blocked'
        })
      ]);
      expect(doneIncluded.body.summary).toMatchObject({
        totalTasks: 3,
        done: 1
      });
      expect(taskKey.body.entries).toEqual([
        expect.objectContaining({
          taskKey: 'TASK-123',
          status: 'blocked'
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it('manages knowledge edges and keeps superseded items out of default search', async () => {
    const core = createDevMeshCore();
    const oldItem = await core.captureKnowledge({
      type: 'decision',
      layer: 'canonical',
      title: 'edge-conflict status uses the legacy workflow',
      summary: 'The edge-conflict status check should prefer the legacy workflow.'
    });
    const newItem = await core.captureKnowledge({
      type: 'decision',
      layer: 'canonical',
      title: 'edge-conflict status uses the current workflow',
      summary: 'The edge-conflict status check should prefer the current workflow.'
    });
    const peerItem = await core.captureKnowledge({
      type: 'decision',
      layer: 'canonical',
      title: 'edge-conflict status duplicates the current workflow',
      summary: 'The duplicate item describes the same current workflow.'
    });
    const contradictingItem = await core.captureKnowledge({
      type: 'decision',
      layer: 'canonical',
      title: 'edge-conflict status rejects the current workflow',
      summary: 'The contradicting item disagrees with the current workflow.'
    });
    const { app, url } = await startHubServer({ core });

    try {
      const supersedes = await requestJson(`${url}/api/v1/admin/knowledge-edges`, {
        method: 'POST',
        body: {
          kind: 'supersedes',
          fromId: newItem.id,
          toId: oldItem.id,
          groupKey: 'default',
          reason: 'The current workflow replaces the legacy workflow.'
        }
      });
      const duplicates = await requestJson(`${url}/api/v1/admin/knowledge-edges`, {
        method: 'POST',
        body: {
          kind: 'duplicates',
          fromId: newItem.id,
          toId: peerItem.id,
          groupKey: 'default'
        }
      });
      const contradicts = await requestJson(`${url}/api/v1/admin/knowledge-edges`, {
        method: 'POST',
        body: {
          kind: 'contradicts',
          fromId: newItem.id,
          toId: contradictingItem.id,
          groupKey: 'default'
        }
      });
      const defaultSearch = await requestJson(`${url}/api/v1/admin/knowledge?query=edge-conflict%20status&limit=10`);
      const allSearch = await requestJson(
        `${url}/api/v1/admin/knowledge?query=edge-conflict%20status&includeSuperseded=true&limit=10`
      );
      const edges = await requestJson(`${url}/api/v1/admin/knowledge-edges?groupKey=default`);
      const conflictEdges = await requestJson(`${url}/api/v1/admin/knowledge-edges?kind=contradicts`);
      const audit = await requestJson(`${url}/api/v1/admin/audit?action=knowledge.edge.created&limit=10`);

      expect(supersedes.body).toMatchObject({
        kind: 'supersedes',
        fromId: newItem.id,
        toId: oldItem.id,
        groupKey: 'default',
        reason: 'The current workflow replaces the legacy workflow.'
      });
      expect(duplicates.body).toMatchObject({
        kind: 'duplicates',
        fromId: newItem.id,
        toId: peerItem.id
      });
      expect(contradicts.body).toMatchObject({
        kind: 'contradicts',
        fromId: newItem.id,
        toId: contradictingItem.id
      });
      expect(defaultSearch.body.items).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({
            id: oldItem.id
          })
        ])
      );
      expect(defaultSearch.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: newItem.id,
            status: 'active'
          })
        ])
      );
      expect(allSearch.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: oldItem.id,
            status: 'superseded'
          }),
          expect.objectContaining({
            id: newItem.id,
            status: 'active'
          })
        ])
      );
      expect(edges.body.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'supersedes',
            toId: oldItem.id
          }),
          expect.objectContaining({
            kind: 'duplicates',
            toId: peerItem.id
          }),
          expect.objectContaining({
            kind: 'contradicts',
            toId: contradictingItem.id
          })
        ])
      );
      expect(conflictEdges.body.edges).toEqual([
        expect.objectContaining({
          id: contradicts.body.id,
          kind: 'contradicts'
        })
      ]);
      expect(audit.body.auditLogs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: 'knowledge.edge.created',
            targetId: supersedes.body.id,
            groupKey: 'default'
          })
        ])
      );
    } finally {
      await app.close();
    }
  });

  it('returns a project brief from canonical knowledge', async () => {
    const core = createDevMeshCore();
    await core.captureKnowledge({
      type: 'decision',
      layer: 'canonical',
      title: 'frontend-dashboard uses project brief',
      summary: 'The frontend-dashboard project should load canonical context first.',
      para: {
        category: 'projects',
        key: 'frontend-dashboard'
      }
    });
    await core.captureKnowledge({
      type: 'decision',
      layer: 'extract',
      title: 'frontend-dashboard extract note',
      summary: 'Extract notes should not appear in the canonical brief.'
    });
    const { app, url } = await startHubServer({ core });

    try {
      const joined = await joinDefaultGroup(url);
      const project = await requestJson(`${url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(joined.accessToken),
        body: {
          id: 'frontend-dashboard',
          name: 'Frontend Dashboard'
        }
      });
      const brief = await requestJson(`${url}/api/v1/projects/frontend-dashboard/brief`, {
        headers: authHeaders(joined.accessToken)
      });

      expect(project.status).toBe(200);
      expect(project.body.project).toMatchObject({
        id: 'frontend-dashboard',
        groupKey: 'default',
        name: 'Frontend Dashboard',
        createdByMemberId: joined.memberId
      });
      expect(brief.status).toBe(200);
      expect(brief.body).toMatchObject({
        projectId: 'frontend-dashboard',
        groupKey: 'default'
      });
      expect(brief.body.items).toHaveLength(1);
      expect(brief.body.items[0]).toMatchObject({
        layer: 'canonical',
        title: 'frontend-dashboard uses project brief'
      });
    } finally {
      await app.close();
    }
  });

  it('serves MCP tools/list and tools/call over streamable HTTP', async () => {
    const core = createDevMeshCore();
    const { app, url } = await startHubServer({ core });
    const client = new Client({
      name: 'dev-mesh-integration-test',
      version: '0.1.0'
    });

    try {
      const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`));
      await client.connect(transport as never);

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(['mesh_search_context', 'mesh_capture_knowledge'])
      );

      const capture = await client.callTool({
        name: 'mesh_capture_knowledge',
        arguments: {
          type: 'decision',
          title: 'MCP streamable HTTP capture',
          summary: 'tools/call should route through the real MCP transport.',
          layer: 'canonical',
          tags: ['mcp']
        }
      });
      const captured = JSON.parse(readTextToolResult(capture));

      expect(captured).toMatchObject({
        title: 'MCP streamable HTTP capture',
        layer: 'canonical',
        tags: ['mcp']
      });

      const search = await client.callTool({
        name: 'mesh_search_context',
        arguments: {
          query: 'streamable HTTP',
          layers: ['canonical']
        }
      });
      const contextPack = JSON.parse(readTextToolResult(search));

      expect(contextPack).toMatchObject({
        query: 'streamable HTTP',
        items: [
          {
            id: captured.id,
            title: 'MCP streamable HTTP capture',
            quality: {
              qualityScore: expect.any(Number)
            }
          }
        ]
      });
    } finally {
      await client.close().catch(() => undefined);
      await app.close();
    }
  }, 30000);

  it('persists hub state and audit logs across server restarts', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-hub-state-'));
    const hubStatePath = join(projectRoot, 'hub-state.json');
    let joined: JoinResponseBody | undefined;

    try {
      const first = await startHubServer({
        core: createDevMeshCore(),
        hubStatePath
      });

      try {
        joined = await joinDefaultGroup(first.url);
        await requestJson(`${first.url}/api/v1/projects`, {
          method: 'POST',
          headers: authHeaders(joined.accessToken),
          body: {
            id: 'persisted-hub-project',
            name: 'Persisted Hub Project'
          }
        });
      } finally {
        await first.app.close();
      }

      if (joined === undefined) {
        throw new Error('Expected join to complete before restart.');
      }

      const persisted = JSON.parse(await readFile(hubStatePath, 'utf8'));
      expect(persisted).toMatchObject({
        version: 1,
        groups: [
          expect.objectContaining({
            key: 'default'
          })
        ],
        projects: [
          expect.objectContaining({
            id: 'persisted-hub-project',
            groupKey: 'default'
          })
        ],
        auditLogs: expect.arrayContaining([
          expect.objectContaining({
            action: 'member.joined',
            targetId: joined.memberId
          }),
          expect.objectContaining({
            action: 'project.created',
            targetId: 'persisted-hub-project'
          })
        ])
      });

      const second = await startHubServer({
        core: createDevMeshCore(),
        hubStatePath
      });

      try {
        const projects = await requestJson(`${second.url}/api/v1/projects`, {
          headers: authHeaders(joined.accessToken)
        });
        const audit = await requestJson(`${second.url}/api/v1/admin/audit?action=project.created`);

        expect(projects.status).toBe(200);
        expect(projects.body.projects).toEqual([
          expect.objectContaining({
            id: 'persisted-hub-project',
            createdByMemberId: joined.memberId
          })
        ]);
        expect(audit.body.auditLogs).toEqual([
          expect.objectContaining({
            action: 'project.created',
            targetId: 'persisted-hub-project'
          })
        ]);
      } finally {
        await second.app.close();
      }
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('persists hub state through an injected store across server restarts', async () => {
    const store = new TestHubStateStore();
    let joined: JoinResponseBody | undefined;

    const first = await startHubServer({
      core: createDevMeshCore(),
      hubStateStore: store
    });

    try {
      joined = await joinDefaultGroup(first.url);
      await requestJson(`${first.url}/api/v1/projects`, {
        method: 'POST',
        headers: authHeaders(joined.accessToken),
        body: {
          id: 'injected-store-project',
          name: 'Injected Store Project'
        }
      });
    } finally {
      await first.app.close();
    }

    if (joined === undefined) {
      throw new Error('Expected join to complete before injected store restart.');
    }

    const second = await startHubServer({
      core: createDevMeshCore(),
      hubStateStore: store
    });

    try {
      const projects = await requestJson(`${second.url}/api/v1/projects`, {
        headers: authHeaders(joined.accessToken)
      });
      const audit = await requestJson(`${second.url}/api/v1/admin/audit?action=project.created`);

      expect(store.saves).toBeGreaterThanOrEqual(2);
      expect(projects.status).toBe(200);
      expect(projects.body.projects).toEqual([
        expect.objectContaining({
          id: 'injected-store-project',
          createdByMemberId: joined.memberId
        })
      ]);
      expect(audit.body.auditLogs).toEqual([
        expect.objectContaining({
          action: 'project.created',
          targetId: 'injected-store-project'
        })
      ]);
    } finally {
      await second.app.close();
    }
  });

  it('persists MCP capture, task, and rating calls when backed by the local store', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-server-'));
    const core = createDevMeshCore({
      projectRoot,
      repository: new JsonlKnowledgeRepository(projectRoot)
    });
    const { app, url } = await startHubServer({ core });
    const client = new Client({
      name: 'dev-mesh-local-store-test',
      version: '0.1.0'
    });

    try {
      const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`));
      await client.connect(transport as never);

      const captureResult = await client.callTool({
        name: 'mesh_capture_knowledge',
        arguments: {
          type: 'decision',
          title: 'Persist MCP capture locally',
          summary: 'Local-store backed MCP capture should write JSONL and an event.',
          tags: ['mcp', 'local-store']
        }
      });
      const captured = JSON.parse(readTextToolResult(captureResult));
      const taskResult = await client.callTool({
        name: 'mesh_capture_task',
        arguments: {
          title: 'Persist MCP task progress',
          summary: 'Task progress should become searchable task knowledge.',
          status: 'done',
          tags: ['task']
        }
      });
      const task = JSON.parse(readTextToolResult(taskResult));
      const rateResult = await client.callTool({
        name: 'mesh_rate_knowledge',
        arguments: {
          id: captured.id,
          rating: 0,
          confidenceDelta: -0.1
        }
      });
      const rated = JSON.parse(readTextToolResult(rateResult));
      const knowledgeJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'knowledge', 'extract', 'entries.jsonl'),
        'utf8'
      );
      const eventsJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'events', `${rated.event.createdAt.slice(0, 7)}.jsonl`),
        'utf8'
      );
      const ratingsJsonl = await readFile(
        join(projectRoot, '.dev-mesh', 'knowledge', 'ratings', `${rated.ratingEvent.createdAt.slice(0, 7)}.jsonl`),
        'utf8'
      );

      expect(captured).toMatchObject({
        title: 'Persist MCP capture locally',
        event: {
          kind: 'knowledge.captured',
          payload: {
            knowledgeId: captured.id
          }
        }
      });
      expect(task).toMatchObject({
        type: 'task',
        summary: '[done] Task progress should become searchable task knowledge.',
        taskStatus: 'done',
        event: {
          kind: 'task.progress.captured'
        }
      });
      expect(rated).toMatchObject({
        id: captured.id,
        quality: {
          rating: 0
        },
        ratingEvent: {
          knowledgeId: captured.id,
          rating: 0,
          confidenceDelta: -0.1
        },
        event: {
          kind: 'knowledge.rated'
        }
      });
      expect(knowledgeJsonl).toContain('"title":"Persist MCP capture locally"');
      expect(knowledgeJsonl).toContain('"title":"Persist MCP task progress"');
      expect(eventsJsonl).toContain('"kind":"knowledge.captured"');
      expect(eventsJsonl).toContain('"kind":"task.progress.captured"');
      expect(eventsJsonl).toContain('"kind":"knowledge.rated"');
      expect(ratingsJsonl).toContain(`"knowledgeId":"${captured.id}"`);
    } finally {
      await client.close().catch(() => undefined);
      await app.close();
      await rm(projectRoot, { recursive: true, force: true });
    }
  }, 30000);
});

async function startHubServer(options: Omit<MeshServerOptions, 'baseUrl'>): Promise<{ app: KoaHubServer; url: string }> {
  const app = await createHubServer(options);
  const url = await app.listen({
    host: '127.0.0.1',
    port: 0
  });

  return {
    app,
    url
  };
}

async function joinDefaultGroup(url: string): Promise<JoinResponseBody> {
  const join = await requestJson<JoinResponseBody>(`${url}/api/v1/join`, {
    method: 'POST',
    body: {
      inviteToken: DEFAULT_LOCAL_INVITE_TOKEN,
      displayName: 'Xiaoyun',
      handle: 'xiaoyun'
    }
  });

  return join.body;
}

async function requestJson<T = any>(url: string, init: JsonRequestInit = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {
    ...(init.headers ?? {})
  };
  let body: string | undefined;

  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }

  const response = await fetch(url, {
    method: init.method ?? 'GET',
    headers,
    body
  });
  const text = await response.text();

  return {
    status: response.status,
    body: text ? (JSON.parse(text) as T) : ({} as T)
  };
}

function readTextToolResult(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const text = content?.find((item) => item.type === 'text')?.text;

  if (text === undefined) {
    throw new Error('Expected a text tool result.');
  }

  return text;
}

function signSyncEvent(input: {
  clientId: string;
  groupKey: string;
  secret: string;
  signedAt?: string;
  keyId?: string;
  event: TestSyncEvent;
}): SignedTestSyncEvent {
  const signature = {
    algorithm: 'hmac-sha256' as const,
    value: '',
    ...(input.signedAt === undefined ? {} : { signedAt: input.signedAt }),
    ...(input.keyId === undefined ? {} : { keyId: input.keyId })
  };
  const value = createHmac('sha256', input.secret)
    .update(
      stableStringify({
        clientId: input.clientId,
        groupKey: input.groupKey,
        event: {
          id: input.event.id,
          kind: input.event.kind,
          createdAt: input.event.createdAt ?? null,
          payload: input.event.payload
        },
        signature: {
          algorithm: signature.algorithm,
          keyId: signature.keyId ?? null,
          signedAt: signature.signedAt ?? null
        }
      })
    )
    .digest('hex');

  return {
    ...input.event,
    signature: {
      ...signature,
      value
    }
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}

function authHeaders(accessToken: string): { authorization: string } {
  return {
    authorization: `Bearer ${accessToken}`
  };
}

interface JsonRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

interface JoinResponseBody {
  memberId: string;
  clientId: string;
  groupKey: string;
  accessToken: string;
  syncSigningSecret: string;
  expiresAt: string;
}

class TestHubStateStore implements HubStatePersistenceStore {
  saves = 0;
  private snapshot: unknown;

  async load(fallback: HubStateOptions = {}): Promise<HubState> {
    return this.snapshot === undefined ? createHubState(fallback) : deserializeHubState(this.snapshot);
  }

  async save(state: HubState): Promise<void> {
    this.snapshot = serializeHubState(state);
    this.saves += 1;
  }
}

interface TestSyncEvent {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt?: string;
}

interface SignedTestSyncEvent extends TestSyncEvent {
  signature: {
    algorithm: 'hmac-sha256';
    value: string;
    signedAt?: string;
    keyId?: string;
  };
}

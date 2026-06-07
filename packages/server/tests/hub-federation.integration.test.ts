import { describe, expect, it } from 'vitest';
import { createHubState, type HubAuthContext } from '../src/hub-state.js';
import { federateHubSyncEvents } from '../src/hub-federation.js';
import { pullHubSyncEvents, pushHubSyncEvents } from '../src/hub-sync.js';

describe('hub federation sync', () => {
  it('replicates group sync events incrementally and idempotently', () => {
    const source = createHubState({
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
      invites: []
    });
    const target = createHubState({
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
      invites: []
    });
    const frontendAuth = createAuth('frontend-team');
    const backendAuth = createAuth('backend-team');

    const firstPush = pushHubSyncEvents(source, frontendAuth, {
      clientId: frontendAuth.clientId,
      events: [
        {
          id: 'evt_frontend_1',
          kind: 'knowledge.created',
          payload: {
            title: 'Federated frontend event'
          },
          createdAt: '2026-06-07T01:00:00.000Z'
        },
        {
          id: 'evt_frontend_tombstone',
          kind: 'knowledge.deleted',
          payload: {
            knowledgeId: 'kn_frontend_1',
            tombstone: true,
            reason: 'Removed stale frontend guidance'
          },
          createdAt: '2026-06-07T01:01:00.000Z'
        }
      ]
    });
    pushHubSyncEvents(source, backendAuth, {
      clientId: backendAuth.clientId,
      events: [
        {
          id: 'evt_backend_1',
          kind: 'knowledge.created',
          payload: {
            title: 'Backend-only event'
          },
          createdAt: '2026-06-07T01:02:00.000Z'
        }
      ]
    });

    const firstSync = federateHubSyncEvents(source, target, {
      peerId: 'peer_server_a',
      groupKey: 'frontend-team'
    });
    const duplicateSync = federateHubSyncEvents(source, target, {
      peerId: 'peer_server_a',
      groupKey: 'frontend-team',
      cursor: undefined
    });
    const secondPush = pushHubSyncEvents(source, frontendAuth, {
      clientId: frontendAuth.clientId,
      events: [
        {
          id: 'evt_frontend_2',
          kind: 'knowledge.updated',
          payload: {
            title: 'Federated frontend event update'
          },
          createdAt: '2026-06-07T01:03:00.000Z'
        }
      ]
    });
    const secondSync = federateHubSyncEvents(source, target, {
      peerId: 'peer_server_a',
      groupKey: 'frontend-team'
    });
    const targetFrontendPull = pullHubSyncEvents(target, frontendAuth, undefined);
    const targetBackendPull = pullHubSyncEvents(target, backendAuth, undefined);
    const [firstTargetEvent, targetTombstoneEvent, secondTargetEvent] = targetFrontendPull.events;

    expect(firstPush).toMatchObject({
      ok: true,
      value: {
        accepted: 2,
        cursor: 'cur_frontend-team_2'
      }
    });
    expect(firstSync).toMatchObject({
      ok: true,
      value: {
        peerId: 'peer_server_a',
        groupKey: 'frontend-team',
        cursor: 'cur_frontend-team_2',
        pulled: 2,
        accepted: 2,
        skipped: 0
      }
    });
    expect(duplicateSync).toMatchObject({
      ok: true,
      value: {
        previousCursor: 'cur_frontend-team_2',
        cursor: 'cur_frontend-team_2',
        pulled: 0,
        accepted: 0,
        skipped: 0
      }
    });
    expect(secondPush).toMatchObject({
      ok: true,
      value: {
        cursor: 'cur_frontend-team_3'
      }
    });
    expect(secondSync).toMatchObject({
      ok: true,
      value: {
        previousCursor: 'cur_frontend-team_2',
        cursor: 'cur_frontend-team_3',
        pulled: 1,
        accepted: 1,
        skipped: 0
      }
    });
    expect(targetFrontendPull.events).toEqual([
      expect.objectContaining({
        id: 'evt_frontend_1',
        payload: {
          title: 'Federated frontend event'
        }
      }),
      expect.objectContaining({
        id: 'evt_frontend_tombstone',
        kind: 'knowledge.deleted',
        payload: {
          knowledgeId: 'kn_frontend_1',
          tombstone: true,
          reason: 'Removed stale frontend guidance'
        }
      }),
      expect.objectContaining({
        id: 'evt_frontend_2',
        payload: {
          title: 'Federated frontend event update'
        }
      })
    ]);
    expect(targetFrontendPull.cursor).toBe('cur_frontend-team_3');
    if (firstTargetEvent?.log === undefined || targetTombstoneEvent?.log === undefined || secondTargetEvent?.log === undefined) {
      throw new Error('Expected federated target events to include log metadata.');
    }
    expect(firstTargetEvent.log).toMatchObject({
      sequence: 1,
      hash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(firstTargetEvent.log.previousHash).toBeUndefined();
    expect(targetTombstoneEvent.log).toMatchObject({
      sequence: 2,
      previousHash: firstTargetEvent.log.hash,
      hash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(secondTargetEvent.log).toMatchObject({
      sequence: 3,
      previousHash: targetTombstoneEvent.log.hash,
      hash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(targetBackendPull).toEqual({
      cursor: 'cur_backend-team_0',
      events: []
    });
    expect(target.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'federation.synced',
          actor: 'peer_server_a',
          groupKey: 'frontend-team',
          payload: expect.objectContaining({
            pulled: 2,
            accepted: 2
          })
        }),
        expect.objectContaining({
          action: 'federation.synced',
          actor: 'peer_server_a',
          groupKey: 'frontend-team',
          payload: expect.objectContaining({
            previousCursor: 'cur_frontend-team_2',
            pulled: 1,
            accepted: 1
          })
        }),
        expect.objectContaining({
          action: 'sync.tombstone_accepted',
          actor: 'peer_server_a',
          targetType: 'knowledge',
          targetId: 'kn_frontend_1',
          groupKey: 'frontend-team',
          payload: expect.objectContaining({
            eventId: 'evt_frontend_tombstone',
            clientId: frontendAuth.clientId,
            reason: 'Removed stale frontend guidance'
          })
        })
      ])
    );
  });

  it('rejects federation when peer, group, or limit inputs are invalid', () => {
    const source = createHubState();
    const target = createHubState();

    expect(
      federateHubSyncEvents(source, target, {
        peerId: '',
        groupKey: 'default'
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'federation.peer_id_required'
      }
    });
    expect(
      federateHubSyncEvents(source, target, {
        peerId: 'peer_server_a',
        groupKey: 'missing'
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'federation.source_group_not_found'
      }
    });
    expect(
      federateHubSyncEvents(source, target, {
        peerId: 'peer_server_a',
        groupKey: 'default',
        limit: 0
      })
    ).toMatchObject({
      ok: false,
      error: {
        code: 'federation.limit_invalid'
      }
    });
  });
});

function createAuth(groupKey: string): HubAuthContext {
  return {
    memberId: `member_${groupKey}`,
    clientId: `client_${groupKey}`,
    groupKey,
    syncSigningSecret: `sync_secret_${groupKey}`
  };
}

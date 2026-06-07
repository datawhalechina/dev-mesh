import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDevMeshCore } from '@mcp-dev-mesh/core';
import type { SyncEvent, SyncEventSignature } from '@mcp-dev-mesh/protocol';
import {
  createHubState,
  DEFAULT_LOCAL_INVITE_TOKEN,
  joinHubGroup,
  type HubAuthContext
} from '../src/hub-state.js';
import { pushHubSyncEvents, replayHubSyncConflicts, verifyHubSyncEventLog } from '../src/hub-sync.js';

describe('hub sync event log verification', () => {
  it('verifies log hash chains and signed event payloads', () => {
    const state = createHubState();
    const joined = joinHubGroup(state, {
      inviteToken: DEFAULT_LOCAL_INVITE_TOKEN,
      displayName: 'Verifier',
      handle: 'verifier'
    });

    expect(joined.ok).toBe(true);

    if (!joined.ok) {
      throw new Error('Expected join to succeed.');
    }

    const auth = createAuth(joined.value);
    const signedEvent = signSyncEvent({
      auth,
      signedAt: '2026-06-07T02:00:00.000Z',
      event: {
        id: 'evt_signed_log_1',
        kind: 'knowledge.created',
        payload: {
          title: 'Signed log entry'
        },
        createdAt: '2026-06-07T01:59:00.000Z'
      }
    });
    const pushed = pushHubSyncEvents(state, auth, {
      clientId: auth.clientId,
      events: [
        signedEvent,
        {
          id: 'evt_unsigned_log_2',
          kind: 'knowledge.updated',
          payload: {
            title: 'Unsigned log entry'
          },
          createdAt: '2026-06-07T02:01:00.000Z'
        }
      ]
    });

    expect(pushed).toMatchObject({
      ok: true,
      value: {
        accepted: 2,
        rejected: []
      }
    });
    expect(
      verifyHubSyncEventLog(state, {
        groupKey: auth.groupKey
      })
    ).toEqual({
      ok: true,
      checked: 2,
      rejected: []
    });

    const [firstEvent, secondEvent] = state.syncEvents.get(auth.groupKey) ?? [];

    if (firstEvent === undefined || secondEvent?.log === undefined) {
      throw new Error('Expected stored sync events with log metadata.');
    }

    firstEvent.payload = {
      title: 'Tampered signed log entry'
    };
    secondEvent.log = {
      ...secondEvent.log,
      previousHash: '0'.repeat(64)
    };

    const verification = verifyHubSyncEventLog(state, {
      groupKey: auth.groupKey,
      actor: 'auditor'
    });

    expect(verification).toMatchObject({
      ok: false,
      checked: 2,
      rejected: expect.arrayContaining([
        {
          id: 'evt_signed_log_1',
          reason: 'event.log_hash_mismatch'
        },
        {
          id: 'evt_signed_log_1',
          reason: 'event.signature_mismatch'
        },
        {
          id: 'evt_unsigned_log_2',
          reason: 'event.log_previous_hash_mismatch'
        }
      ])
    });
    expect(state.auditLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor: 'auditor',
          action: 'sync.event_log_verification_failed',
          targetType: 'sync_log',
          targetId: auth.groupKey,
          groupKey: auth.groupKey,
          payload: expect.objectContaining({
            checked: 2,
            rejected: expect.arrayContaining([
              expect.objectContaining({
                id: 'evt_signed_log_1',
                reason: 'event.signature_mismatch'
              }),
              expect.objectContaining({
                id: 'evt_unsigned_log_2',
                reason: 'event.log_previous_hash_mismatch'
              })
            ])
          })
        })
      ])
    );
  });
});

describe('hub sync conflict replay', () => {
  it('replays offline update conflicts as idempotent contradict edges', async () => {
    const core = createDevMeshCore();
    const state = createHubState();
    const base = await core.captureKnowledge({
      id: 'kn_conflict_base',
      type: 'decision',
      title: 'Offline conflict base',
      summary: 'The base item is updated by two offline clients.'
    });
    const localRevision = await core.captureKnowledge({
      id: 'kn_conflict_revision_local',
      type: 'decision',
      title: 'Offline conflict local revision',
      summary: 'The local client kept the SQLite-backed workflow.'
    });
    const remoteRevision = await core.captureKnowledge({
      id: 'kn_conflict_revision_remote',
      type: 'decision',
      title: 'Offline conflict remote revision',
      summary: 'The remote client switched to a server-backed workflow.'
    });
    const localJoined = joinHubGroup(state, {
      inviteToken: DEFAULT_LOCAL_INVITE_TOKEN,
      displayName: 'Local Writer',
      handle: 'local-writer'
    });
    const remoteJoined = joinHubGroup(state, {
      inviteToken: DEFAULT_LOCAL_INVITE_TOKEN,
      displayName: 'Remote Writer',
      handle: 'remote-writer'
    });

    expect(localJoined.ok).toBe(true);
    expect(remoteJoined.ok).toBe(true);

    if (!localJoined.ok || !remoteJoined.ok) {
      throw new Error('Expected both writers to join.');
    }

    const localAuth = createAuth(localJoined.value);
    const remoteAuth = createAuth(remoteJoined.value);
    const firstPush = pushHubSyncEvents(state, localAuth, {
      clientId: localAuth.clientId,
      events: [
        {
          id: 'evt_conflict_local',
          kind: 'knowledge.updated',
          payload: {
            knowledgeId: base.id,
            revisionId: localRevision.id,
            conflict: true,
            reason: 'Diverged while offline'
          },
          createdAt: '2026-06-07T05:00:00.000Z'
        }
      ]
    });

    expect(firstPush).toMatchObject({
      ok: true,
      value: {
        accepted: 1,
        rejected: [],
        cursor: 'cur_default_1'
      }
    });

    if (!firstPush.ok) {
      throw new Error('Expected first conflict event to be accepted.');
    }

    const secondPush = pushHubSyncEvents(state, remoteAuth, {
      clientId: remoteAuth.clientId,
      events: [
        {
          id: 'evt_conflict_remote',
          kind: 'knowledge.updated',
          payload: {
            knowledgeId: base.id,
            revisionId: remoteRevision.id,
            conflict: true,
            reason: 'Diverged while offline'
          },
          createdAt: '2026-06-07T05:01:00.000Z'
        }
      ]
    });

    expect(secondPush).toMatchObject({
      ok: true,
      value: {
        accepted: 1,
        rejected: [],
        cursor: 'cur_default_2'
      }
    });

    const replay = await replayHubSyncConflicts(state, core, {
      groupKey: localAuth.groupKey,
      cursor: firstPush.value.cursor,
      actor: 'sync-replayer'
    });
    const retry = await replayHubSyncConflicts(state, core, {
      groupKey: localAuth.groupKey,
      cursor: firstPush.value.cursor,
      actor: 'sync-replayer'
    });
    const conflictAudits = state.auditLogs.filter((log) => log.action === 'sync.conflict_replayed');

    expect(replay).toEqual({
      scanned: 1,
      conflicts: 1,
      edgesCreated: 1,
      skipped: 0,
      cursor: 'cur_default_2'
    });
    expect(retry).toEqual({
      scanned: 1,
      conflicts: 1,
      edgesCreated: 0,
      skipped: 1,
      cursor: 'cur_default_2'
    });
    expect(state.knowledgeEdges).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^edge_sync_conflict_[a-f0-9]{24}$/),
        kind: 'contradicts',
        fromId: localRevision.id,
        toId: remoteRevision.id,
        createdBy: 'sync-replayer',
        groupKey: localAuth.groupKey,
        reason: 'Diverged while offline'
      })
    ]);
    expect(conflictAudits).toEqual([
      expect.objectContaining({
        actor: 'sync-replayer',
        action: 'sync.conflict_replayed',
        targetType: 'knowledge-edge',
        targetId: state.knowledgeEdges[0]?.id,
        groupKey: localAuth.groupKey,
        payload: expect.objectContaining({
          knowledgeId: base.id,
          fromId: localRevision.id,
          toId: remoteRevision.id,
          eventIds: ['evt_conflict_local', 'evt_conflict_remote'],
          clientIds: [localAuth.clientId, remoteAuth.clientId],
          reason: 'Diverged while offline'
        })
      })
    ]);
  });
});

function createAuth(joined: {
  memberId: string;
  clientId: string;
  groupKey: string;
  syncSigningSecret?: string;
}): HubAuthContext {
  if (joined.syncSigningSecret === undefined) {
    throw new Error('Expected join response to include syncSigningSecret.');
  }

  return {
    memberId: joined.memberId,
    clientId: joined.clientId,
    groupKey: joined.groupKey,
    syncSigningSecret: joined.syncSigningSecret
  };
}

function signSyncEvent(input: { auth: HubAuthContext; signedAt?: string; event: SyncEvent }): SyncEvent {
  const signature: SyncEventSignature = {
    algorithm: 'hmac-sha256',
    value: '',
    keyId: input.auth.clientId
  };

  if (input.signedAt !== undefined) {
    signature.signedAt = input.signedAt;
  }

  const value = createHmac('sha256', input.auth.syncSigningSecret)
    .update(
      stableStringify({
        clientId: input.auth.clientId,
        groupKey: input.auth.groupKey,
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

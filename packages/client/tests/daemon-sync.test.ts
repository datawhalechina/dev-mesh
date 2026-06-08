import { createHmac } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendProjectEvent, ensureProjectStore } from '@mcp-dev-mesh/local-store';
import { readDaemonSyncStatus, runDaemonSyncOnce } from '../src/daemon-sync.js';

describe('daemon sync', () => {
  it('pushes signed local events, pulls remote events, and records sync status', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-sync-project-'));
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-daemon-sync-global-'));
    const signedAt = '2026-06-08T00:00:00.000Z';
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
      await ensureProjectStore(projectRoot);
      const localEvent = await appendProjectEvent(
        projectRoot,
        'knowledge.captured',
        {
          knowledgeId: 'kn_local_1',
          title: 'Daemon sync captures local events'
        },
        'frontend-app'
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

        if (url === 'http://mesh.test/api/v1/sync/push') {
          const events = (body?.events ?? []) as Array<Record<string, unknown>>;

          expect(init?.headers).toMatchObject({
            authorization: 'Bearer mesh_secret_token'
          });
          expect(body).toMatchObject({
            clientId: joinedServer.clientId
          });
          expect(events).toHaveLength(1);
          const pushedEvent = events[0];

          if (pushedEvent === undefined) {
            throw new Error('Expected one pushed sync event.');
          }

          expect(pushedEvent).toMatchObject({
            id: localEvent.id,
            kind: 'knowledge.captured',
            payload: {
              knowledgeId: 'kn_local_1',
              projectKey: 'frontend-app'
            },
            createdAt: localEvent.createdAt,
            signature: {
              algorithm: 'hmac-sha256',
              keyId: joinedServer.clientId,
              signedAt
            }
          });
          expect((pushedEvent.signature as { value?: unknown }).value).toBe(
            signSyncEvent({
              clientId: joinedServer.clientId,
              groupKey: joinedServer.groupKey,
              secret: joinedServer.syncSigningSecret,
              signedAt,
              event: pushedEvent as TestSyncEvent
            })
          );

          return jsonResponse({
            accepted: 1,
            rejected: [],
            cursor: 'cur_frontend-team_1'
          });
        }

        if (url === 'http://mesh.test/api/v1/sync/pull') {
          return jsonResponse({
            cursor: 'cur_frontend-team_2',
            events: [
              {
                id: 'evt_remote_1',
                kind: 'knowledge.captured',
                payload: {
                  title: 'Remote team context'
                },
                createdAt: '2026-06-08T00:01:00.000Z'
              }
            ]
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
        now: () => new Date(signedAt),
        fetch: fetchStub
      });
      const cursors = JSON.parse(await readFile(join(projectRoot, '.dev-mesh', 'sync', 'cursors.json'), 'utf8')) as {
        remotes: Record<string, { pushedEventIds: string[]; pullCursor: string; pushCursor: string }>;
      };
      const remoteEventsDir = join(projectRoot, '.dev-mesh', 'sync', 'remotes');
      const remoteEventFiles = await readdir(remoteEventsDir);
      const remoteEventFile = remoteEventFiles[0];

      if (remoteEventFile === undefined) {
        throw new Error('Expected pulled remote events to be written.');
      }

      const remoteEvents = await readFile(join(remoteEventsDir, remoteEventFile), 'utf8');
      const storedStatus = await readDaemonSyncStatus(projectRoot);
      const remoteCursor = Object.values(cursors.remotes)[0];

      expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
        'POST http://mesh.test/api/v1/sync/push',
        'GET http://mesh.test/api/v1/sync/pull'
      ]);
      expect(remoteCursor).toMatchObject({
        pushedEventIds: [localEvent.id],
        pullCursor: 'cur_frontend-team_2',
        pushCursor: 'cur_frontend-team_1'
      });
      expect(remoteEvents).toContain('"id":"evt_remote_1"');
      expect(status).toMatchObject({
        enabled: true,
        remotes: [
          {
            serverUrl: joinedServer.serverUrl,
            groupKey: joinedServer.groupKey,
            clientId: joinedServer.clientId,
            queuedLocalEvents: 0,
            pushedEvents: 1,
            pulledEvents: 1,
            rejectedEvents: 0
          }
        ]
      });
      expect(storedStatus).toMatchObject(status);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
      await rm(globalRoot, { recursive: true, force: true });
    }
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers
    }
  });
}

function signSyncEvent(input: {
  clientId: string;
  groupKey: string;
  secret: string;
  signedAt: string;
  event: TestSyncEvent;
}): string {
  return createHmac('sha256', input.secret)
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
          algorithm: 'hmac-sha256',
          keyId: input.clientId,
          signedAt: input.signedAt
        }
      })
    )
    .digest('hex');
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

interface TestSyncEvent {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt?: string;
}

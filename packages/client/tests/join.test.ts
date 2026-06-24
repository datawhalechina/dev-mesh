import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinServerGroup } from '../src/index.js';

describe('joinServerGroup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('joins a server group and records global config without writing tokens to TOML', async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-client-join-'));
    const requests: Array<{ url: string; init?: RequestInit; body?: Record<string, unknown> }> = [];

    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;

      requests.push({
        url,
        init,
        body
      });

      if (url === 'http://mesh.test/.well-known/devmesh') {
        return jsonResponse({
          serverName: 'Test Mesh',
          serverId: 'mesh_test',
          baseUrl: 'http://mesh.test',
          mcpUrl: 'http://mesh.test/mcp',
          groups: {
            required: true,
            defaultJoinMode: 'invite'
          },
          install: {
            npmPackage: 'devmesh',
            command: 'npm install -g devmesh'
          },
          minClientVersion: '0.1.0'
        });
      }

      if (url === 'http://mesh.test/api/v1/join') {
        return jsonResponse({
          memberId: 'member_frontend-team_xiaoyun',
          clientId: 'client_frontend-team_xiaoyun_abc123',
          branch: 'frontend-team',
          accessToken: 'mesh_secret_token',
          syncSigningSecret: 'sync_secret_value',
          expiresAt: '2026-06-13T00:00:00.000Z'
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
    });

    try {
      const result = await joinServerGroup({
        globalRoot,
        serverUrl: 'mesh.test/',
        branch: 'frontend-team',
        displayName: 'Xiaoyun',
        handle: 'xiaoyun',
        inviteToken: 'inv_frontend'
      });
      const config = await readFile(join(globalRoot, 'config.toml'), 'utf8');
      const identity = JSON.parse(await readFile(join(globalRoot, 'identity.json'), 'utf8')) as {
        joinedServers: Array<Record<string, unknown>>;
      };

      expect(result).toMatchObject({
        globalRoot,
        configPath: join(globalRoot, 'config.toml'),
        identityPath: join(globalRoot, 'identity.json'),
        serverUrl: 'http://mesh.test',
        mcpUrl: 'http://mesh.test/mcp',
        branch: 'frontend-team',
        memberId: 'member_frontend-team_xiaoyun',
        clientId: 'client_frontend-team_xiaoyun_abc123',
        expiresAt: '2026-06-13T00:00:00.000Z'
      });
      expect(requests.map((request) => request.url)).toEqual([
        'http://mesh.test/.well-known/devmesh',
        'http://mesh.test/api/v1/join'
      ]);
      expect(requests[1]?.init?.method).toBe('POST');
      expect(requests[1]?.body).toMatchObject({
        inviteToken: 'inv_frontend',
        branch: 'frontend-team',
        displayName: 'Xiaoyun',
        handle: 'xiaoyun',
        hostname: expect.any(String)
      });
      expect(config).toContain('[automation]');
      expect(config).toContain('auto_sync = true');
      expect(config).toContain('[[servers]]');
      expect(config).toContain('server_url = "http://mesh.test"');
      expect(config).toContain('mcp_url = "http://mesh.test/mcp"');
      expect(config).toContain('client_id = "client_frontend-team_xiaoyun_abc123"');
      expect(config).toContain('[[groups]]');
      expect(config).toContain('group_key = "frontend-team"');
      expect(config).toContain('display_name = "Xiaoyun"');
      expect(config).toContain('handle = "xiaoyun"');
      expect(config).not.toContain('mesh_secret_token');
      expect(config).not.toContain('sync_secret_value');
      expect(identity.joinedServers).toHaveLength(1);
      expect(identity.joinedServers[0]).toMatchObject({
        serverUrl: 'http://mesh.test',
        mcpUrl: 'http://mesh.test/mcp',
        branch: 'frontend-team',
        memberId: 'member_frontend-team_xiaoyun',
        clientId: 'client_frontend-team_xiaoyun_abc123',
        accessToken: 'mesh_secret_token',
        syncSigningSecret: 'sync_secret_value'
      });
    } finally {
      await rm(globalRoot, { recursive: true, force: true });
    }
  }, 15000);
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

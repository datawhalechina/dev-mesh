import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDevMeshCore } from '@devmesh/core';
import { createHubServer } from '@devmesh/server';
import { runDmx } from './run-dmx.js';

describe('dmx CLI join', () => {
  it('joins a remote server group and writes global connection records', async () => {
    const globalRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-global-join-'));
    const port = await getFreePort();
    const serverUrl = `http://127.0.0.1:${port}`;
    const app = await createHubServer({
      core: createDevMeshCore(),
      baseUrl: serverUrl,
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
            branch: 'frontend-team'
          }
        ]
      }
    });

    try {
      await app.listen({ host: '127.0.0.1', port });

      const joined = await runDmx(
        [
          'join',
          serverUrl,
          '--group',
          'frontend-team',
          '--name',
          'Xiaoyun',
          '--handle',
          'xiaoyun',
          '--token',
          'inv_frontend',
          '--yes',
          '--json'
        ],
        {
          DEV_MESH_HOME: globalRoot
        }
      );
      const output = JSON.parse(joined.stdout) as JoinCliOutput;
      const config = await readFile(join(globalRoot, 'config.toml'), 'utf8');
      const identity = JSON.parse(await readFile(join(globalRoot, 'identity.json'), 'utf8')) as JoinIdentity;

      expect(output).toMatchObject({
        globalRoot,
        configPath: join(globalRoot, 'config.toml'),
        identityPath: join(globalRoot, 'identity.json'),
        serverUrl,
        mcpUrl: `${serverUrl}/mcp`,
        branch: 'frontend-team',
        memberId: 'member_frontend-team_xiaoyun',
        clientId: expect.stringMatching(/^client_frontend-team_xiaoyun_/),
        expiresAt: expect.any(String)
      });
      expect(config).toContain('[automation]');
      expect(config).toContain('auto_sync = true');
      expect(config).toContain('[[servers]]');
      expect(config).toContain(`server_url = "${serverUrl}"`);
      expect(config).toContain(`mcp_url = "${serverUrl}/mcp"`);
      expect(config).toContain(`client_id = "${output.clientId}"`);
      expect(config).toContain('[[groups]]');
      expect(config).toContain('group_key = "frontend-team"');
      expect(config).toContain('display_name = "Xiaoyun"');
      expect(config).toContain('handle = "xiaoyun"');
      expect(config).not.toContain('mesh_');
      expect(identity.joinedServers).toHaveLength(1);
      expect(identity.joinedServers[0]).toMatchObject({
        serverUrl,
        mcpUrl: `${serverUrl}/mcp`,
        branch: 'frontend-team',
        memberId: output.memberId,
        clientId: output.clientId,
        displayName: 'Xiaoyun',
        handle: 'xiaoyun',
        accessToken: expect.stringMatching(/^mesh_/),
        expiresAt: output.expiresAt
      });
    } finally {
      await app.close();
      await rm(globalRoot, { recursive: true, force: true });
    }
  }, 30000);
});

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Expected a TCP port from the test server.'));
        return;
      }

      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

interface JoinCliOutput {
  globalRoot: string;
  configPath: string;
  identityPath: string;
  serverUrl: string;
  mcpUrl: string;
  branch: string;
  memberId: string;
  clientId: string;
  expiresAt?: string;
}

interface JoinIdentity {
  joinedServers: Array<{
    serverUrl: string;
    mcpUrl: string;
    branch: string;
    memberId: string;
    clientId: string;
    displayName: string;
    handle?: string;
    accessToken: string;
    expiresAt?: string;
  }>;
}

import { describe, expect, it } from 'vitest';
import {
  createPostgresHubStateStore,
  migratePostgresHubStateStore,
  type PostgresExecutor
} from '../src/index.js';

describe('PostgreSQL Hub state store', () => {
  it('loads fallback hub state and saves JSONB snapshots', async () => {
    const db = new FakePostgresExecutor();
    await migratePostgresHubStateStore(db, {
      tableName: 'dev_mesh_hub_state_test'
    });
    const store = createPostgresHubStateStore(db, {
      tableName: 'dev_mesh_hub_state_test'
    });
    const state = await store.load({
      groups: [
        {
          key: 'design',
          displayName: 'Design'
        }
      ],
      invites: [
        {
          token: 'inv_design',
          groupKey: 'design'
        }
      ]
    });

    state.members.set('member_design_alice', {
      memberId: 'member_design_alice',
      clientId: 'client_design_alice',
      groupKey: 'design',
      displayName: 'Alice',
      handle: 'alice',
      joinedAt: '2026-06-07T00:00:00.000Z',
      status: 'active'
    });
    state.tokens.set('mesh_original', {
      token: 'mesh_original',
      memberId: 'member_design_alice',
      clientId: 'client_design_alice',
      groupKey: 'design',
      syncSigningSecret: 'sync_design_secret',
      expiresAt: '2026-06-14T00:00:00.000Z'
    });
    state.projects.set('design:hub-store', {
      id: 'hub-store',
      projectKey: 'hub-store',
      groupKey: 'design',
      name: 'Hub Store',
      createdByMemberId: 'member_design_alice',
      createdAt: '2026-06-07T00:00:00.000Z'
    });
    state.auditLogs.push({
      id: 'audit_postgres_hub_state',
      actor: 'admin',
      action: 'hub_state.saved',
      targetType: 'hub-state',
      targetId: 'default',
      groupKey: 'design',
      createdAt: '2026-06-07T00:00:01.000Z'
    });

    await store.save(state);
    db.savedState = JSON.stringify(db.savedState);

    const restored = await store.load();

    expect(db.queries.some((query) => query.includes('CREATE TABLE IF NOT EXISTS "dev_mesh_hub_state_test"'))).toBe(true);
    expect(db.savedState).toContain('"version":2');
    expect(restored.groups.get('design')).toMatchObject({
      key: 'design',
      displayName: 'Design'
    });
    expect(restored.invites.get('inv_design')).toMatchObject({
      token: 'inv_design',
      groupKey: 'design'
    });
    expect(restored.members.get('member_design_alice')).toMatchObject({
      clientId: 'client_design_alice'
    });
    expect(restored.tokens.get('mesh_original')).toMatchObject({
      syncSigningSecret: 'sync_design_secret'
    });
    expect(restored.projects.get('design:hub-store')).toMatchObject({
      id: 'hub-store',
      groupKey: 'design'
    });
    expect(restored.auditLogs).toEqual([
      expect.objectContaining({
        action: 'hub_state.saved',
        targetId: 'default'
      })
    ]);
  });
});

class FakePostgresExecutor implements PostgresExecutor {
  queries: string[] = [];
  savedState: unknown;

  async query(sql: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.queries.push(sql);

    if (sql.includes('SELECT state')) {
      return {
        rows: this.savedState === undefined ? [] : [{ state: this.savedState }]
      };
    }

    if (sql.includes('INSERT INTO')) {
      const rawState = values?.[1];
      this.savedState = typeof rawState === 'string' ? JSON.parse(rawState) : rawState;
    }

    return {
      rows: []
    };
  }
}

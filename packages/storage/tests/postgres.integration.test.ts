import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createDevMeshCore } from '@devmesh/core';
import {
  createPostgresHubStateStore,
  migratePostgresKnowledgeRepository,
  migratePostgresHubStateStore,
  PostgresKnowledgeRepository,
  type PostgresExecutor
} from '../src/index.js';

const postgresUrl = process.env.DEV_MESH_POSTGRES_URL;
const runWithPostgres = postgresUrl ? it : it.skip;

describe('PostgreSQL knowledge repository integration', () => {
  runWithPostgres(
    'migrates schema, persists knowledge, searches, and updates quality signals',
    async () => {
      const pool = new Pool({
        connectionString: postgresUrl
      });
      const db = createPoolExecutor(pool);
      const tableName = `dev_mesh_knowledge_items_test_${Date.now().toString(36)}`;

      try {
        await dropTable(db, tableName);
        await migratePostgresKnowledgeRepository(db, { tableName });

        const repository = new PostgresKnowledgeRepository(db, { tableName });
        const core = createDevMeshCore({
          projectRoot: 'postgres-integration',
          repository
        });
        const canonical = await core.captureKnowledge({
          type: 'decision',
          layer: 'canonical',
          title: 'PostgreSQL repository durable context',
          summary: 'The postgres-river path stores and searches canonical knowledge.',
          tags: ['postgres', 'repository'],
          para: {
            category: 'areas',
            key: 'storage/postgres'
          },
          createdBy: {
            displayName: 'Storage Test'
          }
        });
        await core.captureKnowledge({
          type: 'pitfall',
          layer: 'extract',
          title: 'Unrelated storage note',
          summary: 'This note should not outrank the postgres-river item.',
          tags: ['storage']
        });
        const rated = await core.rateKnowledge({
          id: canonical.id,
          rating: 1,
          adoptionDelta: 0.25
        });
        const loaded = await repository.get(canonical.id);
        const listed = await repository.list({
          layers: ['canonical'],
          para: {
            category: 'areas',
            key: 'storage'
          },
          tags: ['postgres']
        });
        const searched = await repository.search({
          query: 'postgres-river',
          limit: 3
        });
        const rows = await db.query(`SELECT count(*)::int AS count FROM "${tableName}"`);

        expect(Number(rows.rows[0]?.count)).toBe(2);
        expect(loaded).toMatchObject({
          id: canonical.id,
          title: 'PostgreSQL repository durable context',
          quality: {
            rating: 1
          }
        });
        expect(rated.quality.rating).toBe(1);
        expect(rated.quality.adoptionScore).toBe(0.25);
        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({
          id: canonical.id,
          layer: 'canonical'
        });
        expect(searched[0]).toMatchObject({
          id: canonical.id,
          title: 'PostgreSQL repository durable context'
        });
      } finally {
        await dropTable(db, tableName).catch(() => undefined);
        await pool.end();
      }
    },
    30000
  );

  runWithPostgres(
    'migrates and reloads Hub state snapshots',
    async () => {
      const pool = new Pool({
        connectionString: postgresUrl
      });
      const db = createPoolExecutor(pool);
      const tableName = `dev_mesh_hub_state_test_${Date.now().toString(36)}`;

      try {
        await dropTable(db, tableName);
        await migratePostgresHubStateStore(db, { tableName });

        const store = createPostgresHubStateStore(db, { tableName });
        const state = await store.load({
          groups: [
            {
              key: 'platform',
              displayName: 'Platform'
            }
          ],
          invites: [
            {
              token: 'inv_platform',
              branch: 'platform'
            }
          ]
        });

        state.auditLogs.push({
          id: 'audit_pg_hub_state',
          actor: 'admin',
          action: 'hub_state.postgres_saved',
          targetType: 'hub-state',
          targetId: 'default',
          branch: 'platform',
          createdAt: '2026-06-07T00:00:00.000Z'
        });
        await store.save(state);

        const reloaded = await createPostgresHubStateStore(db, { tableName }).load();
        const rows = await db.query(`SELECT state->>'version' AS version FROM "${tableName}" WHERE id = $1`, ['default']);

        expect(rows.rows[0]?.version).toBe('1');
        expect(reloaded.groups.get('platform')).toMatchObject({
          key: 'platform',
          displayName: 'Platform'
        });
        expect(reloaded.invites.get('inv_platform')).toMatchObject({
          token: 'inv_platform',
          branch: 'platform'
        });
        expect(reloaded.auditLogs).toEqual([
          expect.objectContaining({
            action: 'hub_state.postgres_saved',
            branch: 'platform'
          })
        ]);
      } finally {
        await dropTable(db, tableName).catch(() => undefined);
        await pool.end();
      }
    },
    30000
  );
});

function createPoolExecutor(pool: Pool): PostgresExecutor {
  return {
    async query(sql, values) {
      const result = await pool.query(sql, values ? [...values] : undefined);
      return {
        rows: result.rows
      };
    }
  };
}

function dropTable(db: PostgresExecutor, tableName: string): Promise<unknown> {
  return db.query(`DROP TABLE IF EXISTS "${tableName}"`);
}

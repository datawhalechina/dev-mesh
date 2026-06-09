import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeItem } from '@devmesh/core';
import { JsonlKnowledgeRepository, rebuildProjectIndex, searchProjectIndex } from '@devmesh/local-store';

const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-index-example-'));

try {
  const repository = new JsonlKnowledgeRepository(projectRoot);
  const item = createKnowledgeItem({
    type: 'runbook',
    layer: 'canonical',
    title: 'Rebuild local search before release',
    summary: 'Run dmx index rebuild so mesh.sqlite and manifest.json match JSONL knowledge.',
    tags: ['release', 'search']
  });

  await repository.upsert(item);

  const index = await rebuildProjectIndex(projectRoot);
  const hits = await searchProjectIndex(projectRoot, {
    query: 'local search release',
    layers: ['canonical'],
    limit: 3
  });

  console.log(
    JSON.stringify(
      {
        sqlitePath: index.sqlitePath,
        documentCount: index.documentCount,
        hits
      },
      null,
      2
    )
  );
} finally {
  await rm(projectRoot, { recursive: true, force: true });
}

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevMeshClientRuntime } from '@devmesh/client';
import type { BuildContextPackInput } from '@devmesh/agent';
import type { CaptureKnowledgeInput } from '@devmesh/core';

const projectRoot = await mkdtemp(join(tmpdir(), 'dev-mesh-client-example-'));

try {
  const runtime = createDevMeshClientRuntime({
    projectRoot,
    memberName: 'local-example'
  });

  await runtime.ensureProjectStore();

  const capture: CaptureKnowledgeInput = {
    type: 'decision',
    layer: 'canonical',
    title: 'Prefer typed runtime APIs',
    summary: 'Use createDevMeshClientRuntime when embedding local capture and search flows.',
    tags: ['example', 'runtime']
  };

  await runtime.captureKnowledge(capture);

  const reviewItem = await runtime.enqueueKnowledgeForReview(
    {
      type: 'pitfall',
      title: 'Review generated project facts',
      summary: 'High-risk generated facts should be accepted before publishing.',
      tags: ['review']
    },
    {
      reason: 'Generated from an automated source.'
    }
  );

  await runtime.acceptInboxItem(reviewItem.id);
  await runtime.rebuildIndex();

  const contextQuery: BuildContextPackInput = {
    query: 'typed runtime APIs',
    layers: ['canonical', 'extract'],
    limit: 5
  };
  const contextPack = await runtime.searchContext(contextQuery);

  console.log(JSON.stringify(contextPack, null, 2));
} finally {
  await rm(projectRoot, { recursive: true, force: true });
}

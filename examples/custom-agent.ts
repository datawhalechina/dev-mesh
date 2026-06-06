import { createAgentContextService } from '@mcp-dev-mesh/agent';
import { createDevMeshCore } from '@mcp-dev-mesh/core';

const core = createDevMeshCore({
  projectRoot: process.cwd()
});

await core.captureKnowledge({
  type: 'decision',
  layer: 'canonical',
  title: 'Use AuthSession for login state',
  summary: 'Login state is read through AuthSession instead of direct cookie parsing.',
  para: {
    category: 'areas',
    key: 'backend/auth'
  }
});

const agent = createAgentContextService({ core });
const contextPack = await agent.buildContextPack({
  query: 'login state',
  para: {
    category: 'areas',
    key: 'backend/auth'
  },
  layers: ['canonical', 'extract']
});

console.log(JSON.stringify(contextPack, null, 2));

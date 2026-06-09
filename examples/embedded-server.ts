import { createDevMeshCore } from '@mcp-dev-mesh/core';
import { JsonlKnowledgeRepository } from '@mcp-dev-mesh/local-store';
import { createHubServer, listenMeshServer } from '@mcp-dev-mesh/server';

export async function startEmbeddedDevMeshServer(projectRoot: string, port = 8721): Promise<string> {
  const core = createDevMeshCore({
    projectRoot,
    repository: new JsonlKnowledgeRepository(projectRoot)
  });
  const app = await createHubServer({
    core,
    baseUrl: `http://127.0.0.1:${port}`
  });

  return listenMeshServer(app, {
    host: '127.0.0.1',
    port
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = await startEmbeddedDevMeshServer(process.cwd());
  console.log(`DevMesh server listening at ${url}`);
}

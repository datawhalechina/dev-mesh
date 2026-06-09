import { createBuiltInAdapters } from '@devmesh/adapters';
import { compactCheck } from './doctor-summary.js';
import type { DevMeshDoctorCheck, DoctorContext } from './doctor-types.js';

export async function checkAdapters(context: DoctorContext): Promise<DevMeshDoctorCheck[]> {
  const adapters = createBuiltInAdapters();
  const checks: DevMeshDoctorCheck[] = [];

  for (const adapter of adapters) {
    const adapterKey = adapter.id.replace(/^devmesh\.adapter\./, '');
    const detection = await adapter.detect();
    const configured = await adapter.isConfigured(context.projectRoot);

    checks.push(
      compactCheck({
        id: `adapter.${adapterKey}.detect`,
        category: 'adapter',
        status: detection.detected ? 'ok' : 'warn',
        message: detection.detected
          ? `${detection.name ?? adapterKey} adapter target is detected.`
          : `${adapterKey} adapter target is not detected.`,
        fixHint: detection.detected
          ? undefined
          : detection.reason ?? `Install ${adapterKey} or skip it in dmx init --global if it is not used.`
      })
    );

    checks.push(
      compactCheck({
        id: `adapter.${adapterKey}.configured`,
        category: 'adapter',
        status: configured ? 'ok' : 'warn',
        message: configured
          ? `${adapterKey} is configured for ${context.mcpUrl}.`
          : `${adapterKey} is not configured for the local MCP proxy.`,
        fixHint: configured ? undefined : `Run dmx init --global --tool ${adapterKey} --mcp-url ${context.mcpUrl} --yes.`
      })
    );

    const adapterChecks = await adapter.doctor(context.projectRoot);
    checks.push(
      ...adapterChecks.map((check) =>
        compactCheck({
          id: check.id,
          category: 'adapter',
          status: check.status,
          message: check.message,
          fixHint: check.fixHint
        })
      )
    );
  }

  return checks;
}

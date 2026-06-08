import { DEFAULT_LOCAL_PROXY_URL, getGlobalConfigPaths } from './global-config.js';
import { checkAdapters } from './doctor-adapters.js';
import { checkCapture } from './doctor-capture.js';
import { checkPrivacy } from './doctor-privacy.js';
import { checkProxy } from './doctor-proxy.js';
import { checkProjectStore } from './doctor-store.js';
import { checkSync } from './doctor-sync.js';
import { summarizeChecks } from './doctor-summary.js';
import type { DevMeshDoctorOptions, DevMeshDoctorResult, DoctorContext } from './doctor-types.js';

export type {
  DevMeshDoctorCategory,
  DevMeshDoctorCheck,
  DevMeshDoctorOptions,
  DevMeshDoctorResult,
  DevMeshDoctorStatus
} from './doctor-types.js';

export async function runDevMeshDoctor(options: DevMeshDoctorOptions = {}): Promise<DevMeshDoctorResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const paths = getGlobalConfigPaths(options.globalRoot);
  const context: DoctorContext = {
    projectRoot,
    globalRoot: paths.globalRoot,
    mcpUrl: options.mcpUrl ?? DEFAULT_LOCAL_PROXY_URL
  };
  const checks = [
    ...(await checkProjectStore(context)),
    ...(await checkPrivacy(context)),
    ...(await checkCapture(context)),
    ...(await checkSync(context)),
    ...(await checkProxy(context)),
    ...(await checkAdapters(context))
  ];

  return {
    projectRoot,
    globalRoot: paths.globalRoot,
    summary: summarizeChecks(checks),
    checks
  };
}
